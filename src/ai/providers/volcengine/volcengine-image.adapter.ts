// Copyright 2026 zayum-design
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * 火山引擎图片模型适配器(即梦 Seedream)
 * 尺寸预设全部来自 model.json 的 supports.size.aspect_presets(单一配置源)
 */
import { BaseAdapter } from '../../core/base-adapter';
import type {
  AdapterConfig,
  UnifiedModelRequest,
  UnifiedModelResponse,
} from '../../core/types';
import { ModelException, ModelTimeoutException } from '../../core/exceptions';
import { VolcEngineErrorParser } from './error-parser';
import providerJson from '@/config/models/volcengine.json';

// json 构建期内联,断言为宽松结构(厂商专用字段原样保留)
const providerConfig = providerJson as unknown as {
  variants?: import('../../core/types').AdapterVariant[];
  config?: { reasoningTokenBuffer?: number };
};

export class VolcEngineImageAdapter extends BaseAdapter {
  readonly config: AdapterConfig = {
    modelId: 'volcengine',
    modelName: '即梦图片',
    modelType: 'image',
    capabilities: [
      'image_generation',
      'image_edit',
      'image_variation',
    ],
    isAsync: false,
    enabled: true,
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
  };

  private variantSupportsMap = new Map<string, Record<string, any>>();

  constructor() {
    super();
    // 仅注入 image 类型变体
    (this.config as AdapterConfig).variants = (providerConfig.variants || []).filter(
      (v) => v.enabled !== false && v.type === 'image',
    );
    for (const variant of this.config.variants || []) {
      const supports = (variant as Record<string, any>).supports;
      if (supports) {
        this.variantSupportsMap.set(variant.id, supports);
      }
    }
  }

  protected createErrorParser(): VolcEngineErrorParser {
    return new VolcEngineErrorParser();
  }

  async process(request: UnifiedModelRequest): Promise<UnifiedModelResponse> {
    const startTime = Date.now();
    const modelId = request.modelId;
    const apiKey = await this.getApiKey();
    if (!apiKey) {
      throw new ModelException(
        '未配置火山引擎 API Key,请在「设置」页填写',
        'API_KEY_MISSING',
        401,
        false,
      );
    }

    try {
      const body = this.transformRequest(request);
      const baseUrl =
        this.getVariantBaseUrl(modelId) || this.config.baseUrl!;

      const response = await this.fetchWithTimeout(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        timeout: request.options?.timeout || 180000,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
      }

      const rawData = await response.json();
      return this.transformResponse(rawData, {
        modelId,
        processingTime: Date.now() - startTime,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        throw new ModelTimeoutException(
          modelId,
          request.options?.timeout || 180000,
        );
      }
      if (error instanceof ModelException) throw error;
      throw new ModelException(
        `VolcEngine Image调用失败: ${err.message}`,
        'VOLCENGINE_IMAGE_ERROR',
        500,
        true,
      );
    }
  }

  transformRequest(request: UnifiedModelRequest): unknown {
    const input = this.parseInput(request.input);
    const params = (request.parameters || {}) as Record<string, any>;
    const actualModel = this.config.variants?.some((v) => v.id === request.modelId)
      ? request.modelId
      : this.config.variants?.[0]?.id || 'doubao-seedream-5-0-pro-260628';

    const width = params.width || 1024;
    const height = params.height || 1024;

    // 比例优先用业务语义 aspectRatio(厂商层解析推荐尺寸);无则回退 width/height
    const size = this.resolveRecommendedSize(
      actualModel,
      width,
      height,
      params.aspectRatio,
    );

    const body: Record<string, any> = {
      model: actualModel,
      prompt: input.text || params.prompt || '',
      size,
      watermark: params.watermark ?? false,
    };

    // 参考图片(支持公网 URL 或 base64 data URL)
    if (input.images && input.images.length > 0) {
      if (this.supportsParameter(actualModel, 'image_to_image')) {
        body.image = input.images;
      }
    }

    // 注意:即梦 5.0 图生图一次只返回 1 张(sequential_image_generation/max_images 对图生图无效),
    // 多张由调用方循环请求实现,此处不传数量参数。

    // 可选参数
    if (
      params.seed !== undefined &&
      this.supportsParameter(actualModel, 'seed')
    ) {
      body.seed = params.seed;
    }
    if (
      params.guidance_scale !== undefined &&
      this.supportsParameter(actualModel, 'guidance_scale')
    ) {
      body.guidance_scale = params.guidance_scale;
    }
    if (
      params.output_format &&
      this.supportsParameter(actualModel, 'output_format')
    ) {
      body.output_format = params.output_format;
    }
    if (
      params.response_format &&
      this.supportsParameter(actualModel, 'response_format')
    ) {
      body.response_format = params.response_format;
    }

    // 清理 undefined
    Object.keys(body).forEach((key) => {
      if (body[key] === undefined) delete body[key];
    });

    return body;
  }

  transformResponse(
    rawResponse: unknown,
    metadata?: { modelId: string; processingTime: number },
  ): UnifiedModelResponse {
    const raw = rawResponse as Record<string, any>;
    const images = raw.data?.map((img: any) => img.url) || [];

    return this.buildSuccessResponse(
      {
        urls: images,
      },
      {
        modelId: metadata?.modelId || this.config.modelId,
        processingTime: metadata?.processingTime || 0,
        rawResponse,
      },
    );
  }

  private supportsParameter(modelId: string, parameter: string): boolean {
    const supports = this.variantSupportsMap.get(modelId);
    if (!supports) return true;
    return supports[parameter] === true;
  }

  /**
   * 根据模型与比例,解析火山引擎 API 推荐的 size 值。
   * 尺寸预设全部来自 model.json 的 supports.size.aspect_presets(单一配置源):
   * - 有 aspectRatio:取该比例预设的默认中间档
   * - 无 aspectRatio:按 width*height 选最接近档
   * - 预设未覆盖该比例:基于 min_pixels/max_pixels 按比例计算满足要求的尺寸
   */
  private resolveRecommendedSize(
    modelId: string,
    width: number,
    height: number,
    aspectRatio?: string,
  ): string {
    // ratioKey 统一用横屏形式(aspect_presets 仅存横屏 key),isLandscape 决定返回顺序
    let ratioKey: string;
    let isLandscape: boolean;
    if (aspectRatio) {
      const parts = aspectRatio.split(':').map(Number);
      const aw = parts.length === 2 && parts[0] > 0 ? parts[0] : 16;
      const ah = parts.length === 2 && parts[1] > 0 ? parts[1] : 9;
      isLandscape = aw >= ah;
      ratioKey = isLandscape ? `${aw}:${ah}` : `${ah}:${aw}`;
    } else {
      isLandscape = width >= height;
      ratioKey = this.getAspectRatioKey(width, height);
    }

    const sizeSupports = this.variantSupportsMap.get(modelId)?.size as
      | {
          aspect_presets?: Record<string, string[]>;
          min_pixels?: number;
          max_pixels?: number;
        }
      | undefined;

    // 优先用配置的按比例尺寸预设
    const presets = sizeSupports?.aspect_presets?.[ratioKey];
    if (presets && presets.length > 0) {
      // 过滤超过 max_pixels 的档位:max_pixels 必须与厂商实际限制一致,
      // 此处兜底防御配置偏差(如 5.0 pro 实际上限 4624220,4K 档会被厂商拒)
      const maxPx = sizeSupports?.max_pixels;
      const validPresets = maxPx
        ? presets.filter((p) => {
            const [pw, ph] = p.split('x').map(Number);
            return pw * ph <= maxPx;
          })
        : presets;
      const candidates = validPresets.length > 0 ? validPresets : presets;
      const index = aspectRatio
        ? Math.min(Math.floor(candidates.length / 2), candidates.length - 1)
        : this.pickSizeIndexByPixels(candidates, width * height);
      const [w, h] = candidates[index].split('x').map(Number);
      return isLandscape ? `${w}x${h}` : `${h}x${w}`;
    }

    // 兜底:aspect_presets 未覆盖该比例时,基于 min_pixels/max_pixels 按比例计算
    // 尺寸对齐到 16 的倍数,避免低于 min_pixels 的小尺寸被厂商拒绝
    if (aspectRatio && sizeSupports?.min_pixels) {
      const parts = aspectRatio.split(':').map(Number);
      if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
        const [aw, ah] = parts;
        const ratio = aw / ah;
        const minPx = sizeSupports.min_pixels;
        const maxPx = sizeSupports.max_pixels ?? minPx * 4;
        let h = Math.ceil(Math.sqrt(minPx / ratio) / 16) * 16;
        let w = Math.ceil((h * ratio) / 16) * 16;
        while (w * h > maxPx && h > 16) {
          h -= 16;
          w = Math.ceil((h * ratio) / 16) * 16;
        }
        return isLandscape ? `${w}x${h}` : `${h}x${w}`;
      }
    }
    return `${width}x${height}`;
  }

  /** 从尺寸预设中选最接近目标总像素的档位 */
  private pickSizeIndexByPixels(
    presets: string[],
    totalPixels: number,
  ): number {
    let best = 0;
    let bestDiff = Infinity;
    presets.forEach((p, i) => {
      const [w, h] = p.split('x').map(Number);
      const diff = Math.abs(w * h - totalPixels);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    });
    return best;
  }

  /** 根据宽高计算标准比例 key */
  private getAspectRatioKey(width: number, height: number): string {
    const ratio = Math.max(width, height) / Math.min(width, height);

    const targets = [
      { key: '1:1', value: 1 },
      { key: '16:9', value: 16 / 9 },
      { key: '21:9', value: 21 / 9 },
      { key: '4:3', value: 4 / 3 },
      { key: '3:2', value: 3 / 2 },
    ];

    let closest = targets[0];
    let minDiff = Math.abs(ratio - closest.value);

    for (const t of targets.slice(1)) {
      const diff = Math.abs(ratio - t.value);
      if (diff < minDiff) {
        minDiff = diff;
        closest = t;
      }
    }

    // 差异过大时回退到 16:9
    if (minDiff > 0.15) return '16:9';
    return closest.key;
  }
}
