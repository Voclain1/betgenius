import {NextRequest,NextResponse} from "next/server";import {withJobRun} from "@/lib/jobRuns";import {runNotificationDispatch} from "@/lib/notificationDispatch";
function authorized(r:NextRequest){return !!process.env.CRON_SECRET&&r.headers.get("authorization")===`Bearer ${process.env.CRON_SECRET}`}
export const dynamic="force-dynamic";export const maxDuration=60;
export async function GET(req:NextRequest){if(!authorized(req))return NextResponse.json({error:"Forbidden"},{status:403});return NextResponse.json(await withJobRun("notifications-dispatch",()=>runNotificationDispatch(),r=>`events ${r.events}, claimed ${r.claimed}, delivered ${r.delivered}, retried ${r.retried}`));}
