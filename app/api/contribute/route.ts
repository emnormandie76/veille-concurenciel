import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit } from '@/lib/rate-limit';
import { isValidHttpsUrl } from '@/lib/utils';

export async function POST(request: Request) {
    try {
        const ip = request.headers.get('x-forwarded-for') || "unknown";
        if (!checkRateLimit(ip, 5, 20000)) { // 5 requêtes par 20 secondes
            return NextResponse.json({ error: "Rate limit dépassé" }, { status: 429 });
        }

        const body = await request.json();
        const { schoolId, campusId, programId, categories, userText, urls } = body;

        if (!schoolId || !categories || categories.length === 0 || !urls || urls.length === 0) {
            return NextResponse.json({ error: "Paramètres invalides, école, catégorie et URL sont requis" }, { status: 400 });
        }

        for (const url of urls) {
            if (!isValidHttpsUrl(url)) {
                return NextResponse.json({ error: "URL doit commencer par https://" }, { status: 400 });
            }
        }

        const school = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!school) {
            return NextResponse.json({ error: "École invalide" }, { status: 400 });
        }

        const writes = await Promise.all(categories.map((cat: string) => {
            return prisma.contributionInbox.create({
                data: {
                    source_type: "User_Submission",
                    schoolId,
                    campusId: campusId || null,
                    programId: programId || null,
                    user_text: userText || "",
                    urls: urls,
                    ai_category: cat,
                    status: "Pending_AI"
                }
            });
        }));

        return NextResponse.json({ success: true, ticketsCreated: writes.length });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
}