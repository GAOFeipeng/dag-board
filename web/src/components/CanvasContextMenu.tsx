import { Clipboard, LayoutGrid, Link2, MousePointer2, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { NodeTypeDefinition } from '../types';

export type CanvasContextMenuPosition = {
  x: number;
  y: number;
};

export type CanvasContextMenuProps = {
  position: CanvasContextMenuPosition;
  nodeTypes: NodeTypeDefinition[];
  canPaste: boolean;
  onAddNode: (nodeTypeId: string) => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onAutoLayout: () => void;
  onRestoreEdges: () => void;
  onClearSelection: () => void;
  onClose: () => void;
};

const MENU_WIDTH = 246;
const MENU_MAX_HEIGHT = 560;

const menuStyle: CSSProperties = {
  position: 'fixed',
  width: MENU_WIDTH,
  maxHeight: MENU_MAX_HEIGHT,
  overflow: 'auto',
  padding: 7,
  border: '1px solid #384148',
  borderRadius: 8,
  background: '#171b1f',
  boxShadow: '0 16px 42px rgba(0, 0, 0, 0.36)',
  color: '#edf2f4',
  zIndex: 50,
};

export function CanvasContextMenu({
  position,
  nodeTypes,
  canPaste,
  onAddNode,
  onPaste,
  onSelectAll,
  onAutoLayout,
  onRestoreEdges,
  onClearSelection,
  onClose,
}: CanvasContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const clampedPosition = useMemo(() => clampPosition(position), [position]);

  useEffect(() => {
    menuRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current || !event.target || !(event.target instanceof window.Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t('canvasMenu.title')}
      className="canvas-context-menu nodrag nopan nowheel"
      style={{ ...menuStyle, left: clampedPosition.x, top: clampedPosition.y }}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-section-title">{t('canvasMenu.addNode')}</div>
      <div className="context-node-list">
        {nodeTypes.map((nodeType) => (
          <button key={nodeType.id} type="button" role="menuitem" onClick={() => run(() => onAddNode(nodeType.id))}>
            <Plus size={14} />
            <span>{nodeType.label}</span>
          </button>
        ))}
      </div>
      <div className="context-separator" />
      <button type="button" role="menuitem" disabled={!canPaste} onClick={() => run(onPaste)}>
        <Clipboard size={14} />
        <span>{t('canvasMenu.paste')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onSelectAll)}>
        <MousePointer2 size={14} />
        <span>{t('canvasMenu.selectAll')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onAutoLayout)}>
        <LayoutGrid size={14} />
        <span>{t('canvasMenu.autoLayout')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onRestoreEdges)}>
        <Link2 size={14} />
        <span>{t('canvasMenu.restoreEdges')}</span>
      </button>
      <button type="button" role="menuitem" onClick={() => run(onClearSelection)}>
        <X size={14} />
        <span>{t('canvasMenu.clearSelection')}</span>
      </button>
    </div>
  );
}

function clampPosition(position: CanvasContextMenuPosition): CanvasContextMenuPosition {
  if (typeof window === 'undefined') {
    return position;
  }
  return {
    x: Math.max(8, Math.min(position.x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(position.y, window.innerHeight - MENU_MAX_HEIGHT - 8)),
  };
}
