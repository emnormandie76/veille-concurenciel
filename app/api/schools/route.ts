import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
    try {
        const schools = await prisma.school.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true, name: true }
        });
        return NextResponse.json(schools);
    } catch (error) {
        return NextResponse.json({ error: "Erreur interne" }, { status: 500 });
    }
}