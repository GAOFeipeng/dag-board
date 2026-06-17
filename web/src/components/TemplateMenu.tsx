import { ChevronDown, Workflow } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowTemplateId } from '../graph';

export type WorkflowTemplateMenuItem = {
  id: WorkflowTemplateId;
  label: string;
  description: string;
};

type TemplateMenuProps = {
  templates: WorkflowTemplateMenuItem[];
  onReplaceTemplate: (templateId: WorkflowTemplateId) => void;
};

export function TemplateMenu({ templates, onReplaceTemplate }: TemplateMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current || !event.target || !(event.target instanceof window.Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="template-menu" ref={menuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={t('templateMenu.button')}
      >
        <Workflow size={16} />
        {t('templateMenu.button')}
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="template-menu-popover" role="menu" aria-label={t('templateMenu.title')}>
          <div className="template-menu-heading">{t('templateMenu.title')}</div>
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onReplaceTemplate(template.id);
                setOpen(false);
              }}
            >
              <span>
                <strong>{template.label}</strong>
                <small>{template.description}</small>
              </span>
              <em>{t('templateMenu.replace')}</em>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
