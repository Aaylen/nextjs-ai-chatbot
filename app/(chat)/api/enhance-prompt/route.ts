import { auth } from '@/app/(auth)/auth';
import { myProvider } from '@/lib/ai/providers';
import { ChatSDKError } from '@/lib/errors';
import { streamText } from 'ai';

export async function POST(request: Request) {
  try {
    const { prompt, enhancementType = 'manual' } = await request.json();

    if (!prompt || typeof prompt !== 'string') {
      return new ChatSDKError(
        'bad_request:api',
        'Prompt is required',
      ).toResponse();
    }

    const session = await auth();
    if (!session?.user) {
      return new ChatSDKError('unauthorized:chat').toResponse();
    }

    const isAutoEnhance = enhancementType === 'auto';

    const enhancementPrompt = isAutoEnhance
      ? `You are an intelligent autocomplete assistant. The user is typing a prompt and you should suggest a natural completion.

Guidelines for autocomplete:
- Only complete the current thought or sentence they're working on
- Suggest 3-10 words that would naturally follow what they've written
- Keep suggestions concise and helpful
- Don't rewrite what they've already written
- Focus on completing the immediate thought, not the entire prompt
- Make suggestions that flow naturally from their writing style

Current text: "${prompt}"

Complete with:`
      : `You are a prompt enhancement assistant. Your job is to take a user's basic prompt and enhance it to be more detailed, specific, and effective for getting better responses from an AI assistant.

Guidelines for enhancement:
- Make the prompt more specific and detailed
- Add relevant context where helpful
- Improve clarity and structure
- Maintain the user's original intent
- Don't change the core request, just make it better
- Keep it conversational and natural
- If the prompt is already well-written, make minor improvements
- Respond with ONLY the enhanced prompt text, no quotes, no prefixes, no explanations

Original prompt: "${prompt}"

Provide the enhanced version:`;

    const result = streamText({
      model: myProvider.languageModel('chat-model'),
      prompt: enhancementPrompt,
      temperature: 0.7,
    });

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            const data = JSON.stringify({ content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error in enhance-prompt:', error);
    return new ChatSDKError(
      'bad_request:api',
      'Failed to enhance prompt',
    ).toResponse();
  }
}
