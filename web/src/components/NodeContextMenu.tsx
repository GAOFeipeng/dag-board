import { Ban, Copy, Eye, EyeOff, Pencil, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { isNodeDisabled } from '../runState';
import type { StudioNode } from '../types';

export type NodeContextMenuPosition = {
  x: number;
  y: number;
};

export type NodeContextMenuAction = (nodeId: string, node: StudioNode) => void;

export type NodeContextMenuCallbacks = {
  runToNode?: NodeContextMenuAction;
  viewOutput?: NodeContextMenuAction;
  rename?: NodeContextMenuAction;
  duplicate?: NodeContextMenuAction;
  delete?: NodeContextMenuAction;
  toggleDisabled?: (nodeId: string, nextDisabled: boolean, node: StudioNode) => void;
  togglePreview?: NodeContextMenuAction;
};

export type NodeContextMenuProps = {
  node: StudioNode;
  position: NodeContextMenuPosition;
  callbacks: NodeContextMenuCallbacks;
  hasOutput?: boolean;
  onClose?: () => void;
};

const MENU_WIDTH = 210;
const MENU_HEIGHT = 276;

const menuStyle: CSSProperties = {
  position: 'fixed',
  minWidth: MENU_WIDTH,
  padding: 6,
  border: '1px solid #384148',
  borderRadius: 8,
  background: '#171b1f',
  boxShadow: '0 16px 42px rgba(0, 0, 0, 0.36)',
  color: '#edf2f4',
  zIndex: 50,
};

const itemStyle: CSSProperties = {
  width: '100%',
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 9,
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: 'inherit',
  padding: '0 10px',
  cursor: 'pointer',
};

const disabledItemStyle: CSSProperties = {
  ...itemStyle,
  color: '#69757d',
  cursor: 'not-allowed',
};

const separatorStyle: CSSProperties = {
  height: 1,
  margin: '6px 4px',
  background: '#2a3034',
};

export function NodeContextMenu({ node, position, callbacks, hasOutput = false, onClose }: NodeContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const disabled = isNodeDisabled(node);
  const previewVisible = Boolean(node.data.showPreview);
  const clampedPosition = useMemo(() => clampPosition(position), [position]);

  useEffect(() => {
    menuRef.current?.focus();

    function handlePointerDown(event: PointerEvent) {
      if (!onClose || !menuRef.current || !event.target || !(event.target instanceof window.Node)) {
        return;
      }
      if (!menuRef.current.contains(event.target)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose?.();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const runAction = (action: NodeContextMenuAction | undefined) => {
    action?.(node.id, node);
    onClose?.();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`${node.data.label} actions`}
      className="node-context-menu nodrag nopan nowheel"
      style={{ ...menuStyle, left: clampedPosition.x, top: clampedPosition.y }}
      tabIndex={-1}
      onContextMenu={(event) => event.preventDefault()}
    >
      <MenuItem icon={<Play size={15} />} label={t('contextMenu.runToNode')} disabled={!callbacks.runToNode} onClick={() => runAction(callbacks.runToNode)} />
      <MenuItem
        icon={<Eye size={15} />}
        label={t('contextMenu.viewOutput')}
        disabled={!callbacks.viewOutput || !hasOutput}
        onClick={() => runAction(callbacks.viewOutput)}
      />
      <MenuItem
        icon={previewVisible ? <EyeOff size={15} /> : <Eye size={15} />}
        label={previewVisible ? t('contextMenu.hidePreview') : t('contextMenu.showPreview')}
        disabled={!callbacks.togglePreview}
        onClick={() => runAction(callbacks.togglePreview)}
      />
      <div style={separatorStyle} />
      <MenuItem icon={<Pencil size={15} />} label={t('contextMenu.rename')} disabled={!callbacks.rename} onClick={() => runAction(callbacks.rename)} />
      <MenuItem icon={<Copy size={15} />} label={t('contextMenu.duplicate')} disabled={!callbacks.duplicate} onClick={() => runAction(callbacks.duplicate)} />
      <MenuItem
        icon={<Ban size={15} />}
        label={disabled ? t('contextMenu.enable') : t('contextMenu.disable')}
        disabled={!callbacks.toggleDisabled}
        onClick={() => {
          callbacks.toggleDisabled?.(node.id, !disabled, node);
          onClose?.();
        }}
      />
      <div style={separatorStyle} />
      <MenuItem
        icon={<Trash2 size={15} />}
        label={t('contextMenu.delete')}
        danger
        disabled={!callbacks.delete}
        onClick={() => runAction(callbacks.delete)}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      style={{ ...(disabled ? disabledItemStyle : itemStyle), color: danger && !disabled ? '#ff9b9b' : undefined }}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function clampPosition(position: NodeContextMenuPosition): NodeContextMenuPosition {
  if (typeof window === 'undefined') {
    return position;
  }
  return {
    x: Math.max(8, Math.min(position.x, window.innerWidth - MENU_WIDTH - 8)),
    y: Math.max(8, Math.min(position.y, window.innerHeight - MENU_HEIGHT - 8)),
  };
}
