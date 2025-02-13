import { useState, useEffect } from 'react';
import defaultPrompts from '../defaultPrompts.json';

export interface PromptItem {
  text: string;
  custom: boolean;
  lastUsed?: number;
}

export function usePromptGallery() {
  // Initialize state with default prompts and any stored custom prompts
  const [prompts, setPrompts] = useState<PromptItem[]>(() => {
    try {
      // Get custom prompts from localStorage
      const storedCustomPrompts = localStorage.getItem('customPrompts');
      const customPrompts = storedCustomPrompts ? JSON.parse(storedCustomPrompts) : [];
      
      // Combine default prompts (marked as non-custom) with stored custom prompts
      return [
        ...defaultPrompts.map(p => ({ ...p, custom: false })),
        ...customPrompts
      ];
    } catch (error) {
      console.error('Error loading prompts:', error);
      return defaultPrompts.map(p => ({ ...p, custom: false }));
    }
  });

  // Persist custom prompts whenever they change
  useEffect(() => {
    const customPrompts = prompts.filter(p => p.custom);
    localStorage.setItem('customPrompts', JSON.stringify(customPrompts));
  }, [prompts]);

  // Add a new custom prompt
  const addCustomPrompt = (text: string) => {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    // Check if this prompt already exists (either as default or custom)
    const exists = prompts.some(p => p.text.trim() === trimmedText);
    if (exists) return;

    setPrompts(prev => [...prev, {
      text: trimmedText,
      custom: true,
      lastUsed: Date.now()
    }]);
  };

  // Remove a custom prompt
  const removeCustomPrompt = (index: number) => {
    if (index < 0 || index >= prompts.length || !prompts[index].custom) return;
    setPrompts(prev => prev.filter((_, i) => i !== index));
  };

  // Update lastUsed for a prompt
  const updatePromptUsage = (index: number) => {
    setPrompts(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], lastUsed: Date.now() };
      return updated;
    });
  };

  return {
    prompts,
    addCustomPrompt,
    removeCustomPrompt,
    updatePromptUsage
  };
} 