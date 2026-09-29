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
 * 镜头、运镜、灯光、氛围等翻译工具函数
 */

// 翻译镜头类型
export function translateShotType(shotType: string): string {
  const translations: Record<string, string> = {
    extreme_close_up: '特写',
    close_up: '近景',
    medium_close_up: '中近景',
    medium: '中景',
    medium_long: '中远景',
    long: '远景',
    extreme_long: '极远景',
    two_shot: '双人镜头',
    over_shoulder: '过肩镜头',
    pov: '主观镜头',
    aerial: '航拍镜头',
  };
  return translations[shotType] || shotType;
}

// 翻译运镜方式
export function translateCameraMovements(movements: string[]): string {
  const translations: Record<string, string> = {
    static: '固定',
    push_in: '推近',
    pull_out: '拉远',
    pan_left: '左摇',
    pan_right: '右摇',
    tilt_up: '上摇',
    tilt_down: '下摇',
    track: '跟踪',
    dolly: '移动',
    crane_up: '升降-升',
    crane_down: '升降-降',
    rotate: '旋转',
    zoom: '变焦',
    handheld: '手持晃动',
  };
  return movements.map((m) => translations[m] || m).join('、') + '运镜';
}

// 翻译摄像机角度
export function translateCameraAngle(angle: string): string {
  const translations: Record<string, string> = {
    eye_level: '平视',
    low_angle: '仰视',
    high_angle: '俯视',
    bird_eye: '鸟瞰',
    worm_eye: '虫视',
    dutch_angle: '倾斜',
  };
  return (translations[angle] || angle) + '视角';
}

// 翻译灯光
export function translateLighting(lighting: string): string {
  const translations: Record<string, string> = {
    natural: '自然光',
    soft: '柔光',
    hard: '硬光',
    rembrandt: '伦勃朗光',
    backlight: '逆光',
    rim: '轮廓光',
    practical: '实景光',
    cinematic: '电影光',
  };
  return translations[lighting] || lighting;
}

// 翻译氛围
export function translateMood(mood: string): string {
  const translations: Record<string, string> = {
    bright: '明亮',
    dark: '昏暗',
    warm: '暖色调',
    cool: '冷色调',
    moody: '忧郁',
    ethereal: '空灵',
    noir: '黑色电影',
    vibrant: '活泼',
  };
  return translations[mood] || mood;
}
