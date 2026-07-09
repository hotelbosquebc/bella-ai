import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marca rota/controller como público (sem exigir JWT): webhooks, health, login. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
