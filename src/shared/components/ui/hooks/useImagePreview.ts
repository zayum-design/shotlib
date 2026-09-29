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

import { useState, useCallback } from 'react';

export function useImagePreview() {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');

  const openImagePreview = useCallback((imageUrl: string, title: string) => {
    setPreviewImages([imageUrl]);
    setPreviewCurrentIndex(0);
    setPreviewTitle(title);
    setPreviewModalOpen(true);
  }, []);

  const handlePreviewPrev = useCallback(() => {
    setPreviewCurrentIndex((prev) => (prev > 0 ? prev - 1 : previewImages.length - 1));
  }, [previewImages.length]);

  const handlePreviewNext = useCallback(() => {
    setPreviewCurrentIndex((prev) => (prev < previewImages.length - 1 ? prev + 1 : 0));
  }, [previewImages.length]);

  const closePreview = useCallback(() => {
    setPreviewModalOpen(false);
  }, []);

  return {
    previewModalOpen,
    setPreviewModalOpen,
    previewImages,
    previewCurrentIndex,
    previewTitle,
    openImagePreview,
    handlePreviewPrev,
    handlePreviewNext,
    closePreview,
  };
}
