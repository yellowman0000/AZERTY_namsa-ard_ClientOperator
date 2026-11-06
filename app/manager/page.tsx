import HistoricalLogs from './historical-logs';

export const metadata = {
  title: 'Nam Sa-ard | Historical logs',
  description: 'Read-only history of submitted kiosk logs with checksum verification for Operation Managers.',
};

export default function ManagerPage() {
  return <HistoricalLogs />;
}
