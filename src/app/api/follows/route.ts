import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PREDICTION_CATEGORIES } from "@/lib/enums";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";

const body=z.object({targetType:z.enum(["TEAM","LEAGUE","PREDICTION","CATEGORY"]),targetKey:z.string().min(1).max(100),label:z.string().trim().max(120).optional()});
async function user(){return (await getServerSession(authOptions))?.user?.id;}
async function validateTarget(v:z.infer<typeof body>){
  if((v.targetType==="TEAM"||v.targetType==="LEAGUE")&&!/^\d+$/.test(v.targetKey))return false;
  if(v.targetType==="CATEGORY"&&!PREDICTION_CATEGORIES.includes(v.targetKey as any))return false;
  if(v.targetType==="PREDICTION")return !!await prisma.prediction.findFirst({where:{id:v.targetKey,status:"PUBLISHED"},select:{id:true}});
  return true;
}
export async function GET(){const userId=await user();if(!userId)return NextResponse.json({error:"Unauthorized"},{status:401});return NextResponse.json({follows:await prisma.userFollow.findMany({where:{userId},orderBy:{createdAt:"desc"}})});}
export async function POST(req:NextRequest){const userId=await user();if(!userId)return NextResponse.json({error:"Unauthorized"},{status:401});if(!hasValidMutationOrigin(req))return NextResponse.json({error:"Invalid origin"},{status:403});const parsed=body.safeParse(await req.json().catch(()=>null));if(!parsed.success||!await validateTarget(parsed.data))return NextResponse.json({error:"Invalid follow target"},{status:400});const {targetType,targetKey,label}=parsed.data;const follow=await prisma.userFollow.upsert({where:{userId_targetType_targetKey:{userId,targetType,targetKey}},update:{label},create:{userId,targetType,targetKey,label}});return NextResponse.json({follow},{status:201});}
export async function DELETE(req:NextRequest){const userId=await user();if(!userId)return NextResponse.json({error:"Unauthorized"},{status:401});if(!hasValidMutationOrigin(req))return NextResponse.json({error:"Invalid origin"},{status:403});const parsed=body.pick({targetType:true,targetKey:true}).safeParse(await req.json().catch(()=>null));if(!parsed.success)return NextResponse.json({error:"Invalid target"},{status:400});await prisma.userFollow.deleteMany({where:{userId,...parsed.data}});return NextResponse.json({ok:true});}
