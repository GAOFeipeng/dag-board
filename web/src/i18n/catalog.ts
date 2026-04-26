import i18n from 'i18next';
import type { NodeField, NodePort, NodeTypeDefinition } from '../types';

type Translate = (key: string, options: { defaultValue: string }) => string;
type Exists = (key: string) => boolean;

type CatalogLocalizationOptions = {
  t?: Translate;
  exists?: Exists;
};

const NODE_TYPE_KEY_PREFIX = 'catalog.nodeTypes';

function translateText(key: string, fallback: string, t: Translate): string {
  const translated = t(key, { defaultValue: fallback });
  return typeof translated === 'string' ? translated : fallback;
}

function translateOptionalText(
  key: string,
  fallback: string | undefined,
  t: Translate,
  exists: Exists,
): string | undefined {
  if (fallback === undefined && !exists(key)) {
    return undefined;
  }

  if (fallback === '' && !exists(key)) {
    return fallback;
  }

  return translateText(key, fallback ?? '', t);
}

const defaultTranslate: Translate = (key, options) => {
  const translated = i18n.t(key, options);
  return typeof translated === 'string' ? translated : options.defaultValue;
};

const defaultExists: Exists = (key) => i18n.exists(key);

function localizeNodeField(
  nodeTypeId: string,
  field: NodeField,
  t: Translate,
  exists: Exists,
): NodeField {
  const fieldKey = `${NODE_TYPE_KEY_PREFIX}.${nodeTypeId}.fields.${field.name}`;

  return {
    ...field,
    label: translateText(`${fieldKey}.label`, field.label, t),
    description: translateOptionalText(`${fieldKey}.description`, field.description, t, exists),
    placeholder: translateOptionalText(`${fieldKey}.placeholder`, field.placeholder, t, exists),
  };
}

function localizeNodePort(
  nodeTypeId: string,
  port: NodePort,
  t: Translate,
): NodePort {
  const portKey = `${NODE_TYPE_KEY_PREFIX}.${nodeTypeId}.ports.${port.id}`;
  return {
    ...port,
    label: translateText(`${portKey}.label`, port.label, t),
  };
}

export function localizeNodeTypeDefinition(
  definition: NodeTypeDefinition,
  options: CatalogLocalizationOptions = {},
): NodeTypeDefinition {
  const t = options.t ?? defaultTranslate;
  const exists = options.exists ?? defaultExists;
  const nodeTypeKey = `${NODE_TYPE_KEY_PREFIX}.${definition.id}`;

  return {
    ...definition,
    label: translateText(`${nodeTypeKey}.label`, definition.label, t),
    description: translateText(`${nodeTypeKey}.description`, definition.description, t),
    fields: definition.fields.map((field) => localizeNodeField(definition.id, field, t, exists)),
    input_ports: definition.input_ports?.map((port) => localizeNodePort(definition.id, port, t)),
    output_ports: definition.output_ports?.map((port) => localizeNodePort(definition.id, port, t)),
  };
}

export function localizeNodeTypeCatalog(
  definitions: NodeTypeDefinition[],
  options: CatalogLocalizationOptions = {},
): NodeTypeDefinition[] {
  return definitions.map((definition) => localizeNodeTypeDefinition(definition, options));
}
