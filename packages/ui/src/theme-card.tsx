import { clsx } from 'clsx';
import { Button } from './button';

interface ThemeCardProps {
  name: string;
  previewUrl?: string | null;
  selected?: boolean;
  onSelect: () => void;
}

export function ThemeCard({ name, previewUrl, selected, onSelect }: ThemeCardProps) {
  return (
    <div className={clsx('flex items-center gap-4 py-4', selected && 'bg-neutral-100 rounded-xl px-4')}>
      <div className="flex-1">
        <h3 className="text-body-lg font-semibold">{name}</h3>
      </div>
      <div className="h-[80px] w-[120px] rounded-md bg-neutral-300 overflow-hidden flex-shrink-0">
        {previewUrl && (
          <img src={previewUrl} alt={name} className="h-full w-full object-cover" />
        )}
      </div>
      <Button variant={selected ? 'primary' : 'outline'} size="sm" onClick={onSelect}>
        {selected ? 'Selected' : 'Continue with this theme'}
      </Button>
    </div>
  );
}
