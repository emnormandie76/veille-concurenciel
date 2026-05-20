import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const id = (await params).id;
        const school = await prisma.school.findUnique({
            where: { id },
            include: {
                campuses: {
                    include: {
                        programs: true
                    }
                }
            }
        });
        if (!school) return NextResponse.json({ error: "Non trouvé" }, { status: 404 });
        return NextResponse.json(school);
    } catch (error) {
        return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
    }
}