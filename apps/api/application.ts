import { PracticeLabService, studentView, type PostLine } from '../../packages/accounting-domain/src/service.js';
import { OperationalAccountingService, operationalStudentView, type OperationalStore } from '../../packages/accounting-domain/src/operations.js';
export interface AuthenticatedRequest { studentId: string }
export class StudentApi {
  constructor(private readonly lab: PracticeLabService) {}
  async start(request: AuthenticatedRequest, templateId: string) { return studentView(await this.lab.instantiate(request.studentId, templateId)); }
  async post(request: AuthenticatedRequest, attemptId: string, body: { description: string; occurredOn: string; lines: PostLine[] }) { return this.lab.post(request.studentId, attemptId, body); }
  async reset(request: AuthenticatedRequest, attemptId: string) { return studentView(await this.lab.reset(request.studentId, attemptId)); }
}

export class OperationalStudentApi {
  constructor(private readonly operations: OperationalAccountingService, private readonly store: OperationalStore) {}
  async createCustomer(request: AuthenticatedRequest, attemptId: string, name: string) { return this.operations.createCustomer(request.studentId, attemptId, { name }); }
  async view(request: AuthenticatedRequest, attemptId: string) { const state = await this.store.findForStudent(attemptId, request.studentId); if (!state) return null; return operationalStudentView(state); }
}
