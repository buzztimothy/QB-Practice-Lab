import { PrismaClient } from '@prisma/client';
import { bootstrapCanonicalLab } from '../apps/student/persistence.js';

const prisma=new PrismaClient();
try{const result=await bootstrapCanonicalLab(prisma);console.log(`Canonical bootstrap ready: ${result.labId} ${result.version} ${result.contentHash}`);}finally{await prisma.$disconnect();}
