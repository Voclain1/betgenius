import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || "admin@betgenius.local";
  const password = process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!";
  const passwordHash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: "SUPER_ADMIN", passwordHash },
    create: {
      email,
      passwordHash,
      name: "Super Admin",
      role: "SUPER_ADMIN",
    },
  });

  await prisma.subscription.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      tier: "PREMIUM",
      status: "ACTIVE",
    },
  });

  console.log("Seeded super admin:", email);
}

main().finally(() => prisma.$disconnect());
