import { Body, Controller, Module, Post, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      hotelId: user.hotelId,
      role: user.role,
    });
    return { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? '1d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
