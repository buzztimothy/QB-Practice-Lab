import { PracticeLabService, studentView, type PostLine } from '../../packages/accounting-domain/src/service.js';
export interface AuthenticatedRequest { studentId: string }
export class StudentApi {
  constructor(private readonly lab: PracticeLabService) {}
  async start(request: AuthenticatedRequest, templateId: string) { return studentView(await this.lab.instantiate(request.studentId, templateId)); }
  async post(request: AuthenticatedRequest, attemptId: string, body: { description: string; occurredOn: string; lines: PostLine[] }) { return this.lab.post(request.studentId, attemptId, body); }
  async reset(request: AuthenticatedRequest, attemptId: string) { return studentView(await this.lab.reset(request.studentId, attemptId)); }
}
