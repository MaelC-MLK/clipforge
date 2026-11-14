import { PrismaClient } from "@prisma/client";

// Une seule instance, même quand `next dev` recharge les modules.
const g = globalThis as { prisma?: PrismaClient };
export const db = g.prisma ?? (g.prisma = new PrismaClient());
