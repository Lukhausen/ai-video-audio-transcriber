import React, { useState, useMemo, useImperativeHandle, forwardRef } from 'react';
import { DownOutlined, RightOutlined } from '@ant-design/icons';

interface CollapsibleLLMOutputProps {
  content: string;
}

// Define ref type with available methods
export interface CollapsibleLLMOutputRef {
  getFilteredContent: () => string;
}

const CollapsibleLLMOutput = forwardRef<CollapsibleLLMOutputRef, CollapsibleLLMOutputProps>(({ content }, ref) => {
  // Parse the content to identify think tags
  const parsedContent = useMemo(() => {
    if (!content) return [];
    
    // Regular expression to match <think> </think> tags with any content between them
    const regex = /(<think>[\s\S]*?<\/think>)/g;
    
    // Split the content by the regex
    const parts = content.split(regex);
    
    // Process each part to determine if it's a thinking section
    return parts.map((part, index) => {
      const isThinkSection = part.startsWith('<think>') && part.endsWith('</think>');
      const cleanContent = isThinkSection 
        ? part.replace(/<think>|<\/think>/g, '') 
        : part;
        
      return {
        id: `part-${index}`,
        content: cleanContent,
        isThinkSection,
        rawContent: part
      };
    });
  }, [content]);
  
  // Keep track of which thinking sections are expanded
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  
  // Toggle the expanded state of a thinking section
  const toggleSection = (id: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  // Expose methods through the ref
  useImperativeHandle(ref, () => ({
    // Return content with collapsed thinking sections removed
    getFilteredContent: () => {
      return parsedContent.map(part => {
        // If it's a thinking section, only include it if expanded
        if (part.isThinkSection) {
          return expandedSections[part.id] ? part.rawContent : '';
        }
        // Otherwise include the regular content
        return part.rawContent;
      }).join('');
    }
  }));
  
  return (
    <div className="collapsible-llm-output">
      {parsedContent.map(part => {
        if (part.isThinkSection) {
          const isExpanded = expandedSections[part.id] || false;
          
          return (
            <div key={part.id} className="thinking-section">
              <div 
                className="thinking-header" 
                onClick={() => toggleSection(part.id)}
                title={isExpanded ? "Click to collapse" : "Click to expand"}
              >
                {isExpanded ? <DownOutlined /> : <RightOutlined />}
                <span>Thinking</span>
              </div>
              {isExpanded && (
                <div className="thinking-content">
                  <pre>{part.content}</pre>
                </div>
              )}
            </div>
          );
        }
        
        // Regular content - preserving formatting
        if (part.content.trim()) {
          return (
            <div key={part.id} className="regular-content">
              <pre>{part.content}</pre>
            </div>
          );
        }
        
        // Empty parts (just return them to preserve spacing)
        return <div key={part.id}>{part.content}</div>;
      })}
    </div>
  );
});

export default CollapsibleLLMOutput; 