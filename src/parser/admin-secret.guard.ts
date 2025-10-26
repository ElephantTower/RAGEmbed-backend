import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

@Injectable()
export class AdminSecretGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const adminSecret = this.configService.get<string>('ADMIN_SECRET');

    if (!adminSecret) {
      throw new UnauthorizedException('ADMIN_SECRET not configured');
    }

    const providedSecret = request.headers['x-admin-secret'] as string;
    if (providedSecret !== adminSecret) {
      throw new UnauthorizedException('Invalid admin secret');
    }

    return true;
  }
}
