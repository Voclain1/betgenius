import type { Role, SubscriptionStatus, SubscriptionTier } from "@/lib/enums";
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: Role;
      tier: SubscriptionTier;
      subStatus: SubscriptionStatus;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    tier?: SubscriptionTier;
    subStatus?: SubscriptionStatus;
  }
}
