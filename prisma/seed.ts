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

  // Placeholders only — inactive until real affiliate URLs replace these,
  // so the admin UI and /bet-builder's bookmaker picker have something to
  // manage/test against before any affiliate program signup is done.
  const placeholders = [
    { name: "Bet9ja", affiliateUrl: "https://example.com/affiliate/bet9ja" },
    { name: "SportyBet", affiliateUrl: "https://example.com/affiliate/sportybet" },
    { name: "1xBet", affiliateUrl: "https://example.com/affiliate/1xbet" },
  ];
  for (const p of placeholders) {
    await prisma.bookmaker.upsert({
      where: { name: p.name },
      update: {},
      create: { ...p, active: false },
    });
  }
  console.log("Seeded placeholder bookmakers:", placeholders.map((p) => p.name).join(", "));
}

main().finally(() => prisma.$disconnect());
