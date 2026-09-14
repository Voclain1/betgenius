import { getServerSession } from "next-auth";
import { NextRequest,NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidMutationOrigin } from "@/lib/requestSecurity";
export async function GET(req:NextRequest){const s=await getServerSession(authOptions);if(!s?.user.id)return NextResponse.json({error:"Unauthorized"},{status:401});const cursor=req.nextUrl.searchParams.get("cursor")||undefined;const rows=await prisma.userNotification.findMany({where:{userId:s.user.id},include:{event:true},orderBy:{createdAt:"desc"},take:21,...(cursor?{cursor:{id:cursor},skip:1}:{})});const unread=await prisma.userNotification.count({where:{userId:s.user.id,readAt:null}});return NextResponse.json({notifications:rows.slice(0,20),nextCursor:rows.length>20?rows[19].id:null,unread});}
export async function PATCH(req:NextRequest){const s=await getServerSession(authOptions);if(!s?.user.id)return NextResponse.json({error:"Unauthorized"},{status:401});if(!hasValidMutationOrigin(req))return NextResponse.json({error:"Invalid origin"},{status:403});const id=(await req.json().catch(()=>null))?.id;if(id&&typeof id!=="string")return NextResponse.json({error:"Invalid id"},{status:400});await prisma.userNotification.updateMany({where:{userId:s.user.id,...(id?{id}:{readAt:null})},data:{readAt:new Date()}});return NextResponse.json({ok:true});}

