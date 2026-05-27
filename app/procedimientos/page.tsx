import { Metadata } from 'next';
import ProceduresTimeline from '@/components/procedimientos/ProceduresTimeline';

export const metadata: Metadata = {
  title: 'Procedimientos | Tacos Gavilan',
  description: 'Manual de operaciones y procedimientos de Tacos Gavilan',
};

export default function ProcedimientosPage() {
  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-[#0B1120] relative">
      <ProceduresTimeline />
    </div>
  );
}
