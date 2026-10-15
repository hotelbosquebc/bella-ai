import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Exige JWT numa rota dentro de um controller marcado como @Public().
 *
 * O controller dos canais e publico inteiro - e tem de ser, porque a Meta
 * chama os webhooks sem o nosso login. Mas nem tudo ali e webhook: a conclusao
 * do Cadastro Incorporado parte do NOSSO painel e nao pode ficar aberta ao
 * mundo.
 *
 * Funciona porque o guard usa getAllAndOverride([handler, class]), que devolve
 * o primeiro valor DEFINIDO - e false definido no handler vence o true da
 * classe.
 */
export const Privado = () => SetMetadata(IS_PUBLIC_KEY, false);
