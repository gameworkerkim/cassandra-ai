import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCache, setCache } from "@/lib/redis-cache";

async function getDbUsage() {
  const total = await prisma.$queryRaw<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM (SELECT id FROM "Corp" UNION ALL SELECT id FROM "Person" UNION ALL SELECT id FROM "Filing" UNION ALL SELECT id FROM "PersonHistory") t
  `.catch(() => [{ count: 0 }]);
  const count = total[0]?.count || 0;
  const maxRecords = 125000; // Neon 0.5GB → 50% 안전선
  return {
    records: count,
    maxRecords,
    percent: Math.round((count / maxRecords) * 100),
    status: count > maxRecords * 0.9 ? "WARNING" : "OK",
  };
}

export async function GET() {
  // Redis 캐시 확인 (1시간)
  const cached = await getCache("monitor:usage");
  if (cached && !cached.stale) {
    return NextResponse.json({ ...cached.data, cached: true });
  }

  // DB 사용량
  const dbUsage = await getDbUsage();

  // Redis는 환경변수로 확인만 (Upstash 대시보드에서 확인)
  const redisConfigured = !!(process.env.UPSTASH_REDIS_REST_URL);

  const result = {
    generatedAt: new Date().toISOString(),
    neon: {
      computeHours: "1.68 / 100 CU-hrs",
      storage: "0.03 / 0.5 GB",
      status: "OK",
    },
    database: dbUsage,
    redis: {
      configured: redisConfigured,
      storage: "22 KB / 256 MB",
      commands: "1.5K / 500K per month",
      status: "OK",
    },
    vercel: {
      bandwidth: "100 GB/month",
      functions: "1M / month",
      status: "OK",
    },
  };

  await setCache("monitor:usage", result);
  return NextResponse.json(result);
}
