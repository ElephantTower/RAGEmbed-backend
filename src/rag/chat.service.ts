import { Injectable, Logger } from '@nestjs/common';
import { Chat, Message, Role } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private prisma: PrismaService) {}

  async getOrCreateChat(chatId: string | null = null): Promise<Chat> {
    if (!chatId) {
      return this.prisma.chat.create({ data: {} });
    }

    const chat = await this.prisma.chat.findUnique({
      where: { id: chatId },
    });
    if (chat) return chat;

    return this.prisma.chat.create({ data: { id: chatId } });
  }

  async createMessage(
    chat: Chat,
    content: string,
    role: Role,
    rawContent: string | undefined = undefined,
  ): Promise<Message> {
    return this.prisma.message.create({
      data: { chatId: chat.id, content, role, rawContent },
    });
  }

  async getMessages(chat: Chat): Promise<Message[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        chatId: chat.id,
        role: { not: 'system' },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
    return messages.map((message) => {
      if (message.rawContent) {
        message.content = message.rawContent;
      }
      return message;
    });
  }

  async getMessagesWithSystem(chat: Chat): Promise<Message[]> {
    return this.prisma.message.findMany({
      where: {
        chatId: chat.id,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }
}
