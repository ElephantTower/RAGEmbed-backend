import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { ChatService } from './chat.service';

@Injectable()
export class ChatGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly chatService: ChatService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const token = request.cookies?.token;
    let chat: { id: string };
    let newToken: string | undefined;

    if (!token) {
      chat = await this.chatService.getOrCreateChat();
      newToken = await this.jwtService.signAsync({ sub: chat.id });
    } else {
      try {
        const payload = this.jwtService.verify<{ sub: string }>(token);
        chat = await this.chatService.getOrCreateChat(payload.sub);
      } catch (error: any) {
        if (
          error.name === 'TokenExpiredError' ||
          error.name === 'JsonWebTokenError'
        ) {
          chat = await this.chatService.getOrCreateChat();
          newToken = await this.jwtService.signAsync({ sub: chat.id });
        } else {
          throw new UnauthorizedException(`Invalid token: ${error.message}`);
        }
      }
    }

    if (newToken) {
      response.cookie('token', newToken, {
        httpOnly: true,
        secure: false, // For dev; set to true in production with HTTPS
        sameSite: 'strict',
        maxAge: 86400000, // 1 day in ms
      });
    }

    request['chat'] = chat;

    return true;
  }
}
