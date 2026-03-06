import { z } from 'zod';
import { UserRole } from './enums';

export const RegisterInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(100),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshInput = z.infer<typeof RefreshInput>;

export const UserDto = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: UserRole,
  createdAt: z.string(),
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResponse = z.object({
  user: UserDto,
  accessToken: z.string(),
  refreshToken: z.string(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;
