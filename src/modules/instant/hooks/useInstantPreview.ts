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

export interface UseInstantPreviewReturn {
  previewModalOpen: boolean;
  setPreviewModalOpen: (v: boolean) => void;
  previewImages: string[];
  previewCurrentIndex: number;
  setPreviewCurrentIndex: (v: number | ((p: number) => number)) => void;
  previewTitle: string;
  openImagePreview: (imageUrl: string, title: string) => void;
  openSceneImagesPreview: (images: string[], title: string, startIndex?: number) => void;
  openSceneGridModal: (images: string[], title: string) => void;
  sceneGridModalOpen: boolean;
  setSceneGridModalOpen: (v: boolean) => void;
  sceneGridImages: string[];
  sceneGridTitle: string;
}

export const useInstantPreview = (): UseInstantPreviewReturn => {
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewCurrentIndex, setPreviewCurrentIndex] = useState(0);
  const [previewTitle, setPreviewTitle] = useState('');

  const [sceneGridModalOpen, setSceneGridModalOpen] = useState(false);
  const [sceneGridImages, setSceneGridImages] = useState<string[]>([]);
  const [sceneGridTitle, setSceneGridTitle] = useState('');

  const openImagePreview = useCallback((imageUrl: string, title: string) => {
    setPreviewImages([imageUrl]);
    setPreviewCurrentIndex(0);
    setPreviewTitle(title);
    setPreviewModalOpen(true);
  }, []);

  const openSceneImagesPreview = useCallback((images: string[], title: string, startIndex = 0) => {
    setPreviewImages(images);
    setPreviewCurrentIndex(startIndex);
    setPreviewTitle(title);
    setPreviewModalOpen(true);
  }, []);

  const openSceneGridModal = useCallback((images: string[], title: string) => {
    setSceneGridImages(images);
    setSceneGridTitle(title);
    setSceneGridModalOpen(true);
  }, []);

  return {
    previewModalOpen,
    setPreviewModalOpen,
    previewImages,
    previewCurrentIndex,
    setPreviewCurrentIndex,
    previewTitle,
    openImagePreview,
    openSceneImagesPreview,
    openSceneGridModal,
    sceneGridModalOpen,
    setSceneGridModalOpen,
    sceneGridImages,
    sceneGridTitle,
  };
};
