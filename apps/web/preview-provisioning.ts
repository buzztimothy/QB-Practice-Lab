import type { ClerkClient } from '@clerk/backend';
import type { PrismaClient } from '@prisma/client';

const email=(value:string)=>value.trim().toLowerCase();

export class PreviewProvisioningService {
  constructor(private readonly prisma:PrismaClient,private readonly clerk:Pick<ClerkClient,'invitations'>,private readonly callbackUrl:string){}

  async invite(input:{readonly studentId:string;readonly displayName:string;readonly email:string}){
    const expected=email(input.email);
    const invitation=await this.prisma.$transaction(async tx=>{
      const student=await tx.runtimeStudent.upsert({where:{id:input.studentId},create:{id:input.studentId,displayName:input.displayName,email:expected,status:'INVITED'},update:{displayName:input.displayName,email:expected}});
      if(student.status==='DEACTIVATED')throw new Error('Deactivated students cannot be invited');
      const existing=await tx.previewInvitation.findUnique({where:{provider_email:{provider:'clerk',email:expected}}});
      if(existing&&existing.studentId!==student.id)throw new Error('Invitation identity conflict');
      return existing??tx.previewInvitation.create({data:{studentId:student.id,provider:'clerk',email:expected,status:'PENDING'}});
    });
    if(invitation.status==='SENT'||invitation.status==='CONSUMED')return invitation;
    const provider=await this.clerk.invitations.createInvitation({emailAddress:expected,notify:true,ignoreExisting:false,redirectUrl:this.callbackUrl});
    return this.prisma.previewInvitation.update({where:{id:invitation.id},data:{providerInvitationId:provider.id,status:'SENT'}});
  }

  async deactivate(studentId:string){
    await this.prisma.$transaction(async tx=>{
      await tx.runtimeStudent.update({where:{id:studentId},data:{status:'DEACTIVATED'}});
      await tx.externalIdentityLink.updateMany({where:{studentId},data:{active:false}});
      await tx.previewInvitation.updateMany({where:{studentId,status:{in:['PENDING','SENT']}},data:{status:'REVOKED'}});
      await tx.studentSession.updateMany({where:{studentId,revokedAt:null},data:{revokedAt:new Date()}});
    });
  }
}
