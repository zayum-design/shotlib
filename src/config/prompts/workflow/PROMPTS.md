# 角色生成系统提示词

## AVATAR

正面面部特写，必须纯白背景，大头照风格，面部头顶完整无裁切，五官清晰可见，光线均匀，直视镜头，作为角色一致性参考图，高质量肖像，禁止出现背景，**严格按照角色描述中的性别（男性 / 女性）生成对应的面部与发型特征，严禁生成性别模糊或中性化的形象，严禁出现地点、环境、表情描述等感染生成头像的词汇**
**真实质感要求**：人物必须呈现真实人类的原生质感——保留自然皮肤纹理、轻微毛孔、自然唇纹与真实眼下结构，严禁磨皮、过度美颜与塑料质感；表情平静放松、为自然微情绪，嘴巴自然闭合，不刻意摆拍；头发自然蓬松、允许少量碎发，眼神有自然神态、不空洞；面部高光与阴影过渡自然，画面清晰但不过度锐化，整体贴近普通人手机原相机照片的真实质感，拒绝精致商业写真的假面感。

## FULLBODY

生成目标：真实实拍质感的人物三视图设定图，纯白背景，无场景环境。
三视图组成：要求在同一张图中，按从左至右的顺序，依次生成同一人物的 正面、侧面、背面 三个全身视图，必须全身照，脚部/鞋履按角色设定自然呈现（允许赤脚）。
姿态要求：每个视图均为自然放松的站立姿态，双臂自然下垂，无僵硬动作。
表情要求：面部呈现自然柔和的表情，神态生动真实，避免呆板或夸张；表情为平静放松的自然微情绪，嘴巴自然闭合，不刻意摆拍，眼神有自然神态、不空洞。
真实质感要求：保留自然皮肤纹理、轻微毛孔、自然唇纹与真实眼下结构，严禁磨皮、过度美颜与塑料质感；头发自然蓬松、允许少量碎发；面部高光与阴影过渡自然，画面清晰但不过度锐化，整体贴近普通人手机原相机照片的真实质感，拒绝精致商业写真的假面感。
一致性要求：同一人物在三个视图中，五官、肤色、发型、身材比例、服装配饰必须 100% 统一，无透视畸变。
画面规范：统一光影、比例，三视图等高排列，间距均匀，纯白背景，无场景、无环境元素、无文字、无水印、无 UI 元素。
负面提示词（Negative Prompt）：half body, cropped, missing feet, cut off legs


## REGENERATE

Character reference sheet with 4 views (front, side 90, side 45, back) in one image. Full body standing pose. Pure white background, no scene environment. Variation {{variation}}.
Photorealistic natural human texture: preserve real skin texture with subtle pores, natural lip lines and authentic under-eye structure — strictly no skin smoothing, no over-beautification, no plastic look. Calm, relaxed micro-expression with mouth naturally closed, not posed. Natural fluffy hair with a few loose strands, lively natural eyes. Soft natural highlight-shadow transitions on the face, sharp but not over-sharpened. Casual everyday phone-camera realism, not a polished commercial studio look.

## EXPAND

基于参考图片中的角色形象进行智能扩图，生成一张更丰富、更完整的人物设定参考图。严格保持同一角色的正面、侧面、背面全身站姿完全一致，扩展展示服装纹理、配饰细节和整体造型。白色背景，横向排版，全身完整入镜，角色一致性极强，五官、发型、服装完全统一，高清画质，无任何文字、logo、水印或UI元素。**保持真实皮肤质感：保留自然皮肤纹理与轻微毛孔，严禁磨皮、过度美颜与塑料质感，面部光影过渡自然、清晰但不过度锐化。**

## SINGER_SCENE

画面构图精美，光影质感强烈，电影级调色，高质量画面，无文字、无水印、无UI元素。
