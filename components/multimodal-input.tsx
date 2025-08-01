'use client';

import type { UIMessage } from 'ai';
import cx from 'classnames';
import type React from 'react';
import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
  memo,
} from 'react';
import { toast } from 'sonner';
import { useLocalStorage, useWindowSize } from 'usehooks-ts';

import { ArrowUpIcon, PaperclipIcon, StopIcon } from './icons';
import { PreviewAttachment } from './preview-attachment';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { SuggestedActions } from './suggested-actions';
import equal from 'fast-deep-equal';
import type { UseChatHelpers } from '@ai-sdk/react';
import { useScrollToBottom } from '@/hooks/use-scroll-to-bottom';
import type { VisibilityType } from './visibility-selector';
import type { Attachment, ChatMessage } from '@/lib/types';

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>['status'];
  stop: () => void;
  attachments: Array<Attachment>;
  setAttachments: Dispatch<SetStateAction<Array<Attachment>>>;
  messages: Array<UIMessage>;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  className?: string;
  selectedVisibilityType: VisibilityType;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<Array<string>>([]);
  const [isTextareaFocused, setIsTextareaFocused] = useState<boolean>(false);
  const [isEnhanceModeActive, setIsEnhanceModeActive] =
    useState<boolean>(false);
  const [isEnhancing, setIsEnhancing] = useState<boolean>(false);
  const [originalInput, setOriginalInput] = useState<string>('');
  const [cachedEnhancedPrompt, setCachedEnhancedPrompt] = useState<string>('');
  const [autoEnhanceTimer, setAutoEnhanceTimer] =
    useState<NodeJS.Timeout | null>(null);
  const [lastUserEdit, setLastUserEdit] = useState<string>('');
  const [autocompleteSuggestion, setAutocompleteSuggestion] =
    useState<string>('');
  const [isShowingSuggestion, setIsShowingSuggestion] =
    useState<boolean>(false);
  const currentInputRef = useRef<string>('');
  const [textareaHeight, setTextareaHeight] = useState<number>(98);
  const [isResizing, setIsResizing] = useState<boolean>(false);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    'input',
    '',
  );

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, []);

  const adjustHeight = () => {
    if (textareaRef.current) {
      // Don't auto-adjust height when user is manually resizing
      if (!isResizing) {
        textareaRef.current.style.height = 'auto';
        const newHeight = Math.max(
          textareaHeight,
          textareaRef.current.scrollHeight + 2,
        );
        textareaRef.current.style.height = `${newHeight}px`;
      }
    }
  };

  const resetHeight = () => {
    setTextareaHeight(98);
    if (textareaRef.current) {
      textareaRef.current.style.height = '98px';
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || '';
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adjust height whenever input changes or height state changes
  useEffect(() => {
    adjustHeight();
  }, [input, textareaHeight]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  // Keep the ref in sync with input
  useEffect(() => {
    currentInputRef.current = input;
  }, [input]);

  // Handle resize functionality
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);

      const startY = e.clientY;
      const startHeight = textareaHeight;

      const handleMouseMove = (e: MouseEvent) => {
        const deltaY = startY - e.clientY; // Negative because we want up movement to increase height
        const newHeight = Math.max(
          98,
          Math.min(window.innerHeight * 0.75, startHeight + deltaY),
        );
        setTextareaHeight(newHeight);

        if (textareaRef.current) {
          textareaRef.current.style.height = `${newHeight}px`;
        }
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [textareaHeight],
  );

  // Update textarea height when textareaHeight state changes
  useEffect(() => {
    if (textareaRef.current && !isResizing) {
      textareaRef.current.style.height = `${textareaHeight}px`;
    }
  }, [textareaHeight, isResizing]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = event.target.value;
    setInput(newValue);
    adjustHeight();

    // Clear cached enhanced prompt if user is editing and not in enhance mode
    // (meaning they're editing the original prompt)
    if (
      !isEnhanceModeActive &&
      cachedEnhancedPrompt &&
      originalInput &&
      newValue !== originalInput
    ) {
      setCachedEnhancedPrompt('');
    }

    // Update cached enhanced prompt if user is editing in enhance mode
    if (isEnhanceModeActive && cachedEnhancedPrompt) {
      setCachedEnhancedPrompt(newValue);
    }

    // Clear autocomplete suggestion when user types
    if (isShowingSuggestion) {
      setIsShowingSuggestion(false);
      setAutocompleteSuggestion('');
    }

    // Handle auto-enhancement when in enhance mode
    if (isEnhanceModeActive && !isEnhancing && newValue.trim()) {
      console.log(
        'Setting up auto-enhance timer for:',
        newValue.substring(0, 50),
      );

      // Clear existing timer
      if (autoEnhanceTimer) {
        clearTimeout(autoEnhanceTimer);
      }

      // Set new timer for auto-enhancement
      const newTimer = setTimeout(() => {
        const currentValue = currentInputRef.current;
        console.log(
          'Auto-enhance timer fired, current value:',
          currentValue.substring(0, 50),
        );
        // Only enhance if there's meaningful content and we're still in enhance mode
        if (currentValue.trim() && currentValue.length > 10) {
          enhancePrompt(currentValue, 'auto');
        }
      }, 2000);

      setAutoEnhanceTimer(newTimer);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Tab or Right Arrow to accept autocomplete suggestion
    if (
      (event.key === 'Tab' || event.key === 'ArrowRight') &&
      isShowingSuggestion &&
      autocompleteSuggestion
    ) {
      event.preventDefault();
      const newValue = `${input}${autocompleteSuggestion}`;
      setInput(newValue);
      setIsShowingSuggestion(false);
      setAutocompleteSuggestion('');
      adjustHeight();
      return;
    }

    // Handle Escape to dismiss suggestion
    if (event.key === 'Escape' && isShowingSuggestion) {
      setIsShowingSuggestion(false);
      setAutocompleteSuggestion('');
      return;
    }

    // Handle Enter key (existing logic)
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();

      if (status !== 'ready') {
        toast.error('Please wait for the model to finish its response!');
      } else {
        submitForm();
      }
    }
  };

  const handleFocus = () => {
    setIsTextareaFocused(true);
  };

  const handleBlur = () => {
    setIsTextareaFocused(false);
  };

  // Reset enhance mode when textarea loses focus
  useEffect(() => {
    if (!isTextareaFocused) {
      setIsEnhanceModeActive(false);
      // Clear any pending auto-enhancement
      if (autoEnhanceTimer) {
        clearTimeout(autoEnhanceTimer);
        setAutoEnhanceTimer(null);
      }
    }
  }, [isTextareaFocused, autoEnhanceTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoEnhanceTimer) {
        clearTimeout(autoEnhanceTimer);
      }
    };
  }, [autoEnhanceTimer]);

  const enhancePrompt = async (
    promptText: string,
    enhancementType: 'manual' | 'auto' = 'manual',
  ) => {
    console.log(
      `Starting ${enhancementType} enhancement for:`,
      promptText.substring(0, 50),
    );
    setIsEnhancing(true);
    const previousInput = input; // Store current input in case we need to restore it

    // For autocomplete, don't clear the input, just show suggestion
    if (enhancementType === 'auto') {
      setAutocompleteSuggestion('');
      setIsShowingSuggestion(false);
    } else {
      setInput(''); // Clear textarea to show streaming for manual enhancement
    }

    try {
      const response = await fetch('/api/enhance-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt: promptText,
          enhancementType,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to enhance prompt');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let enhancedText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;

              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  // Clean up the content by removing unwanted prefixes but preserve formatting
                  let cleanContent = parsed.content;

                  // Remove common prefixes that might appear
                  cleanContent = cleanContent.replace(
                    /^(Enhanced prompt:\s*|Enhanced:\s*)/i,
                    '',
                  );

                  // Remove surrounding quotes if they exist, but preserve internal formatting
                  cleanContent = cleanContent.replace(/^["']|["']$/g, '');

                  enhancedText += cleanContent;

                  if (enhancementType === 'auto') {
                    // For autocomplete, show as suggestion
                    setAutocompleteSuggestion(enhancedText.trim());
                    setIsShowingSuggestion(true);
                  } else {
                    // For manual enhancement, stream into textarea
                    setInput(enhancedText);
                    adjustHeight();
                  }
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
      }

      // Final cleanup after streaming is complete
      if (enhancedText) {
        // Remove any remaining unwanted formatting but preserve markdown
        let finalText = enhancedText.trim();

        // Remove surrounding quotes
        finalText = finalText.replace(/^["']|["']$/g, '');

        // Remove common prefixes that might appear at the start
        finalText = finalText.replace(
          /^(Enhanced prompt:\s*|Enhanced:\s*)/i,
          '',
        );

        // Clean up excessive whitespace but preserve line breaks and formatting
        finalText = finalText.replace(/[ \t]+/g, ' ').trim();

        if (enhancementType === 'auto') {
          setAutocompleteSuggestion(finalText);
          setIsShowingSuggestion(true);
        } else {
          setInput(finalText);
          // Cache the enhanced prompt for manual enhancements
          setCachedEnhancedPrompt(finalText);
          adjustHeight();
        }
      }
    } catch (error) {
      console.error('Error enhancing prompt:', error);
      toast.error('Failed to enhance prompt');
      setInput(enhancementType === 'auto' ? previousInput : promptText); // Restore appropriate text on error
      // Adjust height after restoring text
      setTimeout(() => adjustHeight(), 10);
    } finally {
      setIsEnhancing(false);
    }
  };

  const handleEnhancePromptClick = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    if (isEnhancing) return; // Prevent multiple clicks during enhancement

    // Clear any pending auto-enhancement
    if (autoEnhanceTimer) {
      clearTimeout(autoEnhanceTimer);
      setAutoEnhanceTimer(null);
    }

    if (isEnhanceModeActive) {
      // Switch back to original prompt, but first save current enhanced content
      setCachedEnhancedPrompt(input); // Save current enhanced content
      setInput(originalInput);
      setIsEnhanceModeActive(false);
      adjustHeight();
    } else {
      // Enhance the prompt
      if (!input.trim()) {
        toast.error('Please enter some text to enhance');
        return;
      }

      // Check if we have a cached enhanced prompt for this original input
      if (cachedEnhancedPrompt && originalInput === input) {
        // Use cached enhanced prompt
        setInput(cachedEnhancedPrompt);
        setIsEnhanceModeActive(true);
        adjustHeight();
      } else {
        // Clear any stale cached enhanced prompt for different original text
        if (originalInput !== input) {
          setCachedEnhancedPrompt('');
        }
        // Generate new enhanced prompt
        setOriginalInput(input); // Store original for restoration
        setIsEnhanceModeActive(true);
        await enhancePrompt(input, 'manual');
      }
    }

    // Keep the textarea focused and adjust height
    if (textareaRef.current) {
      textareaRef.current.focus();
      // Small delay to ensure the input has been updated
      setTimeout(() => adjustHeight(), 10);
    }
  };

  const submitForm = useCallback(() => {
    window.history.replaceState({}, '', `/chat/${chatId}`);

    sendMessage({
      role: 'user',
      parts: [
        ...attachments.map((attachment) => ({
          type: 'file' as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: 'text',
          text: input,
        },
      ],
    });

    setAttachments([]);
    setLocalStorageInput('');
    resetHeight();
    setInput('');
    setIsEnhanceModeActive(false); // Reset enhance mode after sending
    setOriginalInput(''); // Clear original input
    setCachedEnhancedPrompt(''); // Clear cached enhanced prompt
    setIsShowingSuggestion(false); // Clear autocomplete
    setAutocompleteSuggestion(''); // Clear autocomplete suggestion

    // Clear any pending auto-enhancement timer
    if (autoEnhanceTimer) {
      clearTimeout(autoEnhanceTimer);
      setAutoEnhanceTimer(null);
    }

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    autoEnhanceTimer,
  ]);

  const uploadFile = async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;

        return {
          url,
          name: pathname,
          contentType: contentType,
        };
      }
      const { error } = await response.json();
      toast.error(error);
    } catch (error) {
      toast.error('Failed to upload file, please try again!');
    }
  };

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined,
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error('Error uploading files!', error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments],
  );

  const { isAtBottom, scrollToBottom } = useScrollToBottom();

  useEffect(() => {
    if (status === 'submitted') {
      scrollToBottom();
    }
  }, [status, scrollToBottom]);

  return (
    <div className="relative w-full flex flex-col gap-4">
      <style jsx global>{`
        @keyframes rainbow {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>

      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            sendMessage={sendMessage}
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
          />
        )}

      <input
        type="file"
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
      />

      {(attachments.length > 0 || uploadQueue.length > 0) && (
        <div
          data-testid="attachments-preview"
          className="flex flex-row gap-2 overflow-x-scroll items-end"
        >
          {attachments.map((attachment) => (
            <PreviewAttachment key={attachment.url} attachment={attachment} />
          ))}

          {uploadQueue.map((filename) => (
            <PreviewAttachment
              key={filename}
              attachment={{
                url: '',
                name: filename,
                contentType: '',
              }}
              isUploading={true}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col">
        {isTextareaFocused && (
          <button
            className={cx(
              'relative rounded-t-2xl px-3 py-1.5 text-sm w-fit ml-3 overflow-hidden z-9 cursor-pointer transition-colors border',
              isEnhanceModeActive
                ? 'bg-white text-black hover:bg-zinc-100 border-black'
                : 'bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200',
              isEnhanceModeActive ? '-mb-1' : '',
              isEnhancing ? 'opacity-50 cursor-not-allowed' : '',
            )}
            onClick={handleEnhancePromptClick}
            onMouseDown={(e) => e.preventDefault()} // Prevent losing focus
            type="button"
            disabled={isEnhancing}
          >
            <div
              className={cx(
                'absolute inset-0 rounded-t-2xl p-[2px]',
                !isEnhanceModeActive && 'animate-pulse',
              )}
              style={
                isEnhanceModeActive
                  ? { background: 'white', border: '1px solid black' }
                  : {
                      background:
                        'linear-gradient(45deg, #b91c1c, #ca8a04, #16a34a, #2563eb, #7c3aed, #db2777, #b91c1c)',
                      backgroundSize: '400% 400%',
                      animation: 'rainbow 3s ease infinite',
                    }
              }
            >
              <div
                className={cx(
                  'h-full w-full rounded-t-2xl',
                  isEnhanceModeActive ? 'bg-white' : 'bg-blue-100',
                )}
              />
            </div>
            <div className="relative z-9">
              {isEnhancing
                ? 'Enhancing...'
                : isEnhanceModeActive
                  ? 'Original Prompt'
                  : 'Enhance Prompt'}
            </div>
          </button>
        )}
        <div className="relative">
          {isEnhanceModeActive && (
            <div
              className="absolute inset-0 rounded-2xl p-[4px] pointer-events-none z-9"
              style={{
                background:
                  'linear-gradient(45deg, #b91c1c, #ca8a04, #16a34a, #2563eb, #7c3aed, #db2777, #b91c1c)',
                backgroundSize: '400% 400%',
                animation: 'rainbow 3s ease infinite',
              }}
            >
              <div className="h-full w-full rounded-2xl bg-muted" />
            </div>
          )}
          <div
            style={
              isEnhanceModeActive && isTextareaFocused
                ? {
                    background:
                      'linear-gradient(45deg, #b91c1c, #ca8a04, #16a34a, #2563eb, #7c3aed, #db2777, #b91c1c)',
                    backgroundSize: '400% 400%',
                    animation: 'rainbow 3s ease infinite',
                    borderRadius: '1rem', // match rounded-2xl
                    padding: '6px', // add a little padding
                  }
                : undefined
            }
            className="relative"
          >
            {/* Autocomplete suggestion overlay */}
            {isShowingSuggestion && autocompleteSuggestion && (
              <div className="absolute inset-0 pointer-events-none z-10">
                <div
                  className="min-h-[24px] w-full rounded-2xl px-3 py-2 text-base pb-10 whitespace-pre-wrap overflow-hidden resize-none"
                  style={{
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                    lineHeight: 'inherit',
                    color: 'transparent',
                  }}
                >
                  {input}
                  <span
                    className="text-gray-400 opacity-60"
                    style={{ color: 'rgb(156, 163, 175, 0.6)' }}
                  >
                    {autocompleteSuggestion}
                  </span>
                </div>
              </div>
            )}
            <div className="relative">
              <Textarea
                data-testid="multimodal-input"
                ref={textareaRef}
                placeholder="Send a message..."
                value={input}
                onChange={handleInput}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{
                  height: `${textareaHeight}px`,
                  maxHeight: 'calc(75dvh)',
                  minHeight: '98px',
                }}
                className={cx(
                  'overflow-y-auto resize-none rounded-2xl !text-base pb-10 relative z-9 transition-all duration-200',
                  isEnhanceModeActive ? '' : 'focus-visible:ring-2',
                  className,
                )}
                rows={2}
                autoFocus
              />
              {/* Resize handle - invisible hover zone at top */}
              <button
                type="button"
                className="absolute top-0 left-0 right-0 h-3 cursor-ns-resize z-10 hover:bg-gray-200/20 transition-colors bg-transparent border-none p-0"
                onMouseDown={handleResizeStart}
                aria-label="Drag to resize textarea"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 p-2 w-fit flex flex-row justify-start">
        <AttachmentsButton fileInputRef={fileInputRef} status={status} />
      </div>

      <div className="absolute bottom-0 right-0 p-2 w-fit flex flex-row justify-end">
        {status === 'submitted' ? (
          <StopButton stop={stop} setMessages={setMessages} />
        ) : (
          <SendButton
            input={input}
            submitForm={submitForm}
            uploadQueue={uploadQueue}
          />
        )}
      </div>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) return false;
    if (prevProps.status !== nextProps.status) return false;
    if (!equal(prevProps.attachments, nextProps.attachments)) return false;
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType)
      return false;

    return true;
  },
);

function PureAttachmentsButton({
  fileInputRef,
  status,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>['status'];
}) {
  return (
    <Button
      data-testid="attachments-button"
      className="rounded-md rounded-bl-lg p-[7px] h-fit dark:border-zinc-700 hover:dark:bg-zinc-900 hover:bg-zinc-200"
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      disabled={status !== 'ready'}
      variant="ghost"
    >
      <PaperclipIcon size={14} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
}) {
  return (
    <Button
      data-testid="stop-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);

function PureSendButton({
  submitForm,
  input,
  uploadQueue,
}: {
  submitForm: () => void;
  input: string;
  uploadQueue: Array<string>;
}) {
  return (
    <Button
      data-testid="send-button"
      className="rounded-full p-1.5 h-fit border dark:border-zinc-600"
      onClick={(event) => {
        event.preventDefault();
        submitForm();
      }}
      disabled={input.length === 0 || uploadQueue.length > 0}
    >
      <ArrowUpIcon size={14} />
    </Button>
  );
}

const SendButton = memo(PureSendButton, (prevProps, nextProps) => {
  if (prevProps.uploadQueue.length !== nextProps.uploadQueue.length)
    return false;
  if (prevProps.input !== nextProps.input) return false;
  return true;
});
