import { ChevronDown, Plus, RotateCcw, Workflow } from 'lucide-react';
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
  onInsertTemplate: (templateId: WorkflowTemplateId) => void;
  onReplaceTemplate: (templateId: WorkflowTemplateId) => void;
};

export function TemplateMenu({ templates, onInsertTemplate, onReplaceTemplate }: TemplateMenuProps) {
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
            <div key={template.id} className="template-menu-item">
              <span className="template-menu-copy">
                <strong>{template.label}</strong>
                <small>{template.description}</small>
              </span>
              <span className="template-menu-actions">
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`${t('templateMenu.insert')} ${template.label}`}
                  onClick={() => {
                    onInsertTemplate(template.id);
                    setOpen(false);
                  }}
                >
                  <Plus size={13} />
                  {t('templateMenu.insert')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-label={`${t('templateMenu.replace')} ${template.label}`}
                  onClick={() => {
                    onReplaceTemplate(template.id);
                    setOpen(false);
                  }}
                >
                  <RotateCcw size={13} />
                  {t('templateMenu.replace')}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
