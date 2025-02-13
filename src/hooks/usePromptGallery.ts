import { useState, useEffect, useMemo } from 'react';
import defaultPrompts from '../defaultPrompts.json';

export interface PromptItem {
  text: string;
  custom: boolean;
  lastUsed?: number;
}

export function usePromptGallery() {
  // Store only custom (user‑added) prompts in state.
  const [customPrompts, setCustomPrompts] = useState<PromptItem[]>(() => {
    try {
      const stored = localStorage.getItem('customPrompts');
      return stored ? JSON.parse(stored) as PromptItem[] : [];
    } catch (error) {
      console.error('Error loading custom prompts:', error);
      return [];
    }
  });

  // Persist only custom prompts to localStorage.
  useEffect(() => {
    localStorage.setItem('customPrompts', JSON.stringify(customPrompts));
  }, [customPrompts]);

  // The merged prompts: custom prompts get displayed first, then default prompts.
  const combinedPrompts = useMemo(() => {
    return [
      ...customPrompts,
      ...defaultPrompts.map(p => ({ ...p, custom: false }))
    ];
  }, [customPrompts]);

  // Add a new custom prompt.
  // The new prompt is prepended so that it appears at the top.
  const addCustomPrompt = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Check if this prompt already exists (check both custom and default).
    const existsInCustom = customPrompts.some(p => p.text.trim() === trimmedText);
    const existsInDefault = defaultPrompts.some(p => p.text.trim() === trimmedText);
    if (existsInCustom || existsInDefault) return;

    const newPrompt: PromptItem = { text: trimmedText, custom: true, lastUsed: Date.now() };
    // Prepend so that the new prompt is on top.
    setCustomPrompts(prev => [newPrompt, ...prev]);
  };

  // Remove a custom prompt.
  // The parameter 'index' here is the index in the merged (combined) array.
  // Since default prompts appear after custom ones, if index is within [0, customPrompts.length),
  // then remove the corresponding custom prompt.
  const removeCustomPrompt = (index: number) => {
    if (index < 0 || index >= customPrompts.length) return;
    setCustomPrompts(prev => prev.filter((_, i) => i !== index));
  };

  // Update lastUsed for a prompt.
  // In this implementation updatePromptUsage doesn't re-sort the list.
  // Only when a new prompt is added is the new ordering applied.
  const updatePromptUsage = (index: number) => {
    if (index < 0 || index >= customPrompts.length) return;
    setCustomPrompts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], lastUsed: Date.now() };
      return updated;
    });
  };

  return {
    prompts: combinedPrompts,
    addCustomPrompt,
    removeCustomPrompt,
    updatePromptUsage,
  };
} 