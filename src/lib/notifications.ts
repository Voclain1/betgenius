import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { canViewCategory } from "@/lib/access";
import type { PredictionCategory } from "@/lib/enums";
import { safeNotificationLink } from "@/lib/notificationLinks";

export type EventInput = { eventKey:string; type:string; predictionId?:string; fixtureApiId?:number|null; category?:string|null; leagueApiId?:number|null; teamApiIds?:number[]; title:string; body:string; link:string; data?:Record<string,unknown>; availableAt?:Date; expiresAt?:Date|null };
export async function createNotificationEvent(input: EventInput, db: any = prisma) {
  return db.notificationEvent.upsert({ where:{eventKey:input.eventKey}, update:{}, create:{...input, teamApiIds:input.teamApiIds??[], link:safeNotificationLink(input.link), data:input.data as any} });
}

export function publicationEventKey(id:string, publishedAt:Date){ return `prediction:${id}:published:${publishedAt.toISOString()}`; }
export function materialSnapshot(p:{market:string;pick:string;odds:number|null;kickoff:Date|null;status:string}) { return {market:p.market,pick:p.pick,odds:p.odds,kickoff:p.kickoff?.toISOString()??null,status:p.status}; }
export function materialChangeKey(id:string, before:unknown, after:unknown){ return `prediction:${id}:changed:${createHash("sha256").update(JSON.stringify({before,after})).digest("hex").slice(0,20)}`; }
export function settlementEventKey(id:string,outcome:string,settledAt:Date){ return `prediction:${id}:settled:${outcome}:${settledAt.toISOString()}`; }

async function eligibleFollowers(event:{predictionId:string|null;category:string|null;leagueApiId:number|null;teamApiIds:number[];createdAt:Date;data:unknown}) {
  const clauses:any[]=[];
  if(event.predictionId) clauses.push({targetType:"PREDICTION",targetKey:event.predictionId});
  if(event.category) clauses.push({targetType:"CATEGORY",targetKey:event.category});
  for(const category of (((event.data as any)?.categories as string[]|undefined)??[])) clauses.push({targetType:"CATEGORY",targetKey:category});
  if(event.leagueApiId) clauses.push({targetType:"LEAGUE",targetKey:String(event.leagueApiId)});
  for(const id of event.teamApiIds) clauses.push({targetType:"TEAM",targetKey:String(id)});
  if(!clauses.length) return [];
  return prisma.userFollow.findMany({where:{OR:clauses,createdAt:{lte:event.createdAt}},select:{userId:true}}).then(x=>[...new Set(x.map(y=>y.userId))]);
}

export async function stillFollowsEvent(userId:string,event:{predictionId:string|null;category:string|null;leagueApiId:number|null;teamApiIds:number[];data:unknown}){
  const categories=[event.category,...(((event.data as any)?.categories as string[]|undefined)??[])].filter((x):x is string=>!!x);
  const OR:any[]=[];if(event.predictionId)OR.push({targetType:"PREDICTION",targetKey:event.predictionId});if(event.leagueApiId)OR.push({targetType:"LEAGUE",targetKey:String(event.leagueApiId)});for(const id of event.teamApiIds)OR.push({targetType:"TEAM",targetKey:String(id)});for(const category of categories)OR.push({targetType:"CATEGORY",targetKey:category});
  return OR.length>0&&!!await prisma.userFollow.findFirst({where:{userId,OR},select:{id:true}});
}

export async function fanOutPendingEvents(limit=25) {
  const events=await prisma.notificationEvent.findMany({where:{availableAt:{lte:new Date()},fannedOutAt:null},orderBy:{createdAt:"asc"},take:limit});
  let recipients=0;
  for(const event of events){
    const ids=await eligibleFollowers(event);
    if(ids.length){ await prisma.notificationDelivery.createMany({data:ids.map(userId=>({eventId:event.id,userId})),skipDuplicates:true}); recipients+=ids.length; }
    await prisma.notificationEvent.update({where:{id:event.id},data:{fannedOutAt:new Date()}});
  }
  return {events:events.length,recipients};
}

export function inQuietHours(now:Date, timezone:string, start:number|null, end:number|null){
  if(start==null||end==null||start===end)return false;
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const minute=Number(parts.find(x=>x.type==="hour")?.value)*60+Number(parts.find(x=>x.type==="minute")?.value);
  return start<end ? minute>=start&&minute<end : minute>=start||minute<end;
}

export function localDayStartUtc(now:Date,timezone:string){const fmt=new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});const parts=(date:Date)=>Object.fromEntries(fmt.formatToParts(date).filter(p=>p.type!=="literal").map(p=>[p.type,Number(p.value)]));const here=parts(now),guess=Date.UTC(here.year,here.month-1,here.day);const atGuess=parts(new Date(guess)),represented=Date.UTC(atGuess.year,atGuess.month-1,atGuess.day,atGuess.hour,atGuess.minute,atGuess.second);return new Date(guess-(represented-guess));}

export async function claimDeliveries(limit=50){
  const token=randomUUID(),now=new Date(),until=new Date(Date.now()+60_000);
  const candidates=await prisma.notificationDelivery.findMany({where:{status:{in:["PENDING","RETRY"]},nextAttemptAt:{lte:now},OR:[{leasedUntil:null},{leasedUntil:{lt:now}}]},orderBy:{createdAt:"asc"},take:limit,select:{id:true}});
  if(!candidates.length)return {token,rows:[]};
  await prisma.notificationDelivery.updateMany({where:{id:{in:candidates.map(x=>x.id)},OR:[{leasedUntil:null},{leasedUntil:{lt:now}}]},data:{leaseToken:token,leasedUntil:until}});
  return {token,rows:await prisma.notificationDelivery.findMany({where:{leaseToken:token},include:{event:true,user:{include:{subscription:true,notificationPreference:true,pushSubscriptions:true}}}})};
}

export function preferenceAllows(type:string,p:any){
  if(type==="NEW_PREDICTION")return p?.newPredictions??true;
  if(type==="KICKOFF_REMINDER")return p?.kickoffReminders??true;
  if(type==="TIP_CHANGED"||type==="WITHDRAWN")return p?.tipChanges??true;
  if(type.startsWith("RESULT_"))return p?.results??true;
  return true;
}

export function entitled(category:string|null,user:any){ return !category || canViewCategory(category as PredictionCategory,user.subscription?.tier,user.subscription?.status,user.role); }
