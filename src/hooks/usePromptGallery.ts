import { useState, useEffect, useMemo } from 'react';
import defaultPrompts from '../defaultPrompts.json';

export interface PromptItem {
  text: string;
  custom: boolean;
  lastUsed?: number;
  useCount?: number;
}

const CUSTOM_PROMPTS_KEY = 'customPrompts';
const PROMPT_USAGE_KEY = 'promptUsage';

type PromptUsage = Record<string, { useCount: number; lastUsed: number }>;

const normalizePrompt = (text: string) => text.trim().replace(/\s+/g, ' ');
const promptKey = (text: string) => normalizePrompt(text).toLowerCase();

export function usePromptGallery() {
  const [customPrompts, setCustomPrompts] = useState<PromptItem[]>(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_PROMPTS_KEY);
      const parsed = stored ? JSON.parse(stored) as PromptItem[] : [];
      return parsed.map(prompt => ({
        ...prompt,
        text: normalizePrompt(prompt.text),
        custom: true,
      }));
    } catch (error) {
      console.error('Error loading custom prompts:', error);
      return [];
    }
  });

  const [promptUsage, setPromptUsage] = useState<PromptUsage>(() => {
    try {
      const stored = localStorage.getItem(PROMPT_USAGE_KEY);
      return stored ? JSON.parse(stored) as PromptUsage : {};
    } catch (error) {
      console.error('Error loading prompt usage:', error);
      return {};
    }
  });

  useEffect(() => {
    localStorage.setItem(CUSTOM_PROMPTS_KEY, JSON.stringify(customPrompts));
  }, [customPrompts]);

  useEffect(() => {
    localStorage.setItem(PROMPT_USAGE_KEY, JSON.stringify(promptUsage));
  }, [promptUsage]);

  const combinedPrompts = useMemo(() => {
    const prompts = [
      ...customPrompts,
      ...defaultPrompts.map(p => ({ ...p, custom: false })),
    ];

    return prompts
      .map((prompt, index) => {
        const usage = promptUsage[promptKey(prompt.text)];
        return {
          ...prompt,
          useCount: usage?.useCount ?? prompt.useCount ?? 0,
          lastUsed: usage?.lastUsed ?? prompt.lastUsed ?? 0,
          originalIndex: index,
        };
      })
      .sort((a, b) => {
        if (b.useCount !== a.useCount) return b.useCount - a.useCount;
        if ((b.lastUsed || 0) !== (a.lastUsed || 0)) return (b.lastUsed || 0) - (a.lastUsed || 0);
        return a.originalIndex - b.originalIndex;
      })
      .map(({ originalIndex, ...prompt }) => prompt);
  }, [customPrompts, promptUsage]);

  const addCustomPrompt = (text: string) => {
    const trimmedText = normalizePrompt(text);
    if (!trimmedText) return;

    const key = promptKey(trimmedText);
    const existsInCustom = customPrompts.some(prompt => promptKey(prompt.text) === key);
    const existsInDefault = defaultPrompts.some(prompt => promptKey(prompt.text) === key);
    if (existsInCustom || existsInDefault) return;

    setCustomPrompts(prev => [{ text: trimmedText, custom: true }, ...prev]);
  };

  const removeCustomPrompt = (text: string) => {
    const key = promptKey(text);
    setCustomPrompts(prev => prev.filter(prompt => promptKey(prompt.text) !== key));
    setPromptUsage(prev => {
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
  };

  const updatePromptUsage = (text: string) => {
    const normalized = normalizePrompt(text);
    if (!normalized) return;

    const key = promptKey(normalized);
    setPromptUsage(prev => {
      const current = prev[key];
      return {
        ...prev,
        [key]: {
          useCount: (current?.useCount ?? 0) + 1,
          lastUsed: Date.now(),
        },
      };
    });
  };

  return {
    prompts: combinedPrompts,
    addCustomPrompt,
    removeCustomPrompt,
    updatePromptUsage,
  };
}
