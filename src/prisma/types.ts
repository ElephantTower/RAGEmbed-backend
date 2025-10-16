export {};

declare global {
  namespace PrismaJson {
    interface Example {
      position: number;
      participantsAmount: number;
      failsRequired: number;
      status: 'success' | 'fail' | null;
      failsAmount: number;
    }
  }
}
