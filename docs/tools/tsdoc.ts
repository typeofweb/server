import {
  DocBlock,
  DocBlockTag,
  DocCodeSpan,
  DocComment,
  DocDeclarationReference,
  DocErrorText,
  DocEscapedText,
  DocExcerpt,
  DocFencedCode,
  DocHtmlAttribute,
  DocHtmlEndTag,
  DocHtmlStartTag,
  DocInheritDocTag,
  DocInlineTag,
  DocLinkTag,
  DocMemberIdentifier,
  DocMemberReference,
  DocMemberSelector,
  DocMemberSymbol,
  DocNode,
  DocNodeKind,
  DocParagraph,
  DocParamBlock,
  DocParamCollection,
  DocPlainText,
  DocSection,
  DocSoftBreak,
  StandardTags,
  TSDocTagDefinition,
} from '@microsoft/tsdoc';
import { Node, Literal, Parent } from 'unist';
import { inlineCode, text, paragraph, link, code, root } from 'mdast-builder';
import { Context } from './types';
import { as } from './utils';
import { referenceToLink } from './files';
import { ApiDocumentedItem, ApiItem } from '@microsoft/api-extractor-model';
import { toHtmlString } from './stringify';

export function printTsDoc(context: Context, doc: DocNode): Node[] | Node {
  switch (doc.kind) {
    case DocNodeKind.Block: {
      const d = as<DocBlock>(doc);
      break;
    }
    case DocNodeKind.BlockTag: {
      const d = as<DocBlockTag>(doc);
      break;
    }
    case DocNodeKind.Excerpt: {
      const d = as<DocExcerpt>(doc);
      break;
    }
    case DocNodeKind.FencedCode: {
      const d = as<DocFencedCode>(doc);
      return code(d.language, d.code);
    }
    case DocNodeKind.CodeSpan: {
      const d = as<DocCodeSpan>(doc);
      return inlineCode(d.code);
    }
    case DocNodeKind.Comment: {
      const d = as<DocComment>(doc);
      break;
    }
    case DocNodeKind.DeclarationReference: {
      const d = as<DocDeclarationReference>(doc);
      break;
    }
    case DocNodeKind.ErrorText: {
      const d = as<DocErrorText>(doc);
      break;
    }
    case DocNodeKind.EscapedText: {
      const d = as<DocEscapedText>(doc);
      break;
    }
    case DocNodeKind.HtmlAttribute: {
      const d = as<DocHtmlAttribute>(doc);
      break;
    }
    case DocNodeKind.HtmlEndTag: {
      const d = as<DocHtmlEndTag>(doc);
      break;
    }
    case DocNodeKind.HtmlStartTag: {
      const d = as<DocHtmlStartTag>(doc);
      break;
    }
    case DocNodeKind.InheritDocTag: {
      const d = as<DocInheritDocTag>(doc);
      break;
    }
    case DocNodeKind.InlineTag: {
      const d = as<DocInlineTag>(doc);
      break;
    }
    case DocNodeKind.LinkTag: {
      const d = as<DocLinkTag>(doc);
      if (d.codeDestination) {
        const result = referenceToLink(context, d.codeDestination, d.linkText);
        return result
          ? link(result.url, '', d.linkText ? text(d.linkText) : inlineCode(result.linkText))
          : d.linkText
          ? inlineCode(d.linkText)
          : [];
      } else if (d.urlDestination) {
        const linkText = d.linkText || d.urlDestination;
        return link(d.urlDestination, '', text(linkText));
      } else if (d.linkText) {
        return link(d.linkText);
      }
    }
    case DocNodeKind.MemberIdentifier: {
      const d = as<DocMemberIdentifier>(doc);
      break;
    }
    case DocNodeKind.MemberReference: {
      const d = as<DocMemberReference>(doc);
      break;
    }
    case DocNodeKind.MemberSelector: {
      const d = as<DocMemberSelector>(doc);
      break;
    }
    case DocNodeKind.MemberSymbol: {
      const d = as<DocMemberSymbol>(doc);
      break;
    }
    case DocNodeKind.Paragraph: {
      const d = as<DocParagraph>(doc);
      return paragraph(d.getChildNodes().flatMap((n) => printTsDoc(context, n)));
    }
    case DocNodeKind.ParamBlock: {
      const d = as<DocParamBlock>(doc);
      break;
    }
    case DocNodeKind.ParamCollection: {
      const d = as<DocParamCollection>(doc);
      return d.getChildNodes().flatMap((n) => printTsDoc(context, n));
    }
    case DocNodeKind.PlainText: {
      const d = as<DocPlainText>(doc);
      return text(d.text);
    }
    case DocNodeKind.Section: {
      const d = as<DocSection>(doc);
      return d.getChildNodes().flatMap((n) => printTsDoc(context, n));
    }
    case DocNodeKind.SoftBreak: {
      const d = as<DocSoftBreak>(doc);
      return text(' ');
    }
  }
  console.warn(`${doc.kind} was not handled`);
  return [];
}

export function trimWhitespaceInlineCode(data: Node[]): Node[] {
  const firstCodeIndex = data.reduce(
    (foundIndex, n, idx) => (foundIndex !== -1 ? foundIndex : n.type === 'inlineCode' ? idx : -1),
    -1,
  );
  const lastCodeIndex = data.reduceRight(
    (foundIndex, n, idx) => (foundIndex !== -1 ? foundIndex : n.type === 'inlineCode' ? idx : -1),
    -1,
  );

  if (firstCodeIndex === -1 || lastCodeIndex === -1) {
    return data;
  }

  return data.filter((n, idx) => {
    if (idx < firstCodeIndex || idx > lastCodeIndex) {
      return n.type !== 'text' || ((n as Literal).value as string).trim().length > 0;
    }
    return true;
  });
}

export function collapseParagraphs(data: Node[]): Node[] {
  return data
    .flat()
    .flatMap((node) => (node.type === 'paragraph' ? collapseParagraphs((node as Parent).children) : node));
}

type TsDocTagNames = {
  [K in keyof typeof StandardTags]: typeof StandardTags[K] extends TSDocTagDefinition ? K : never;
}[keyof typeof StandardTags];

export function getTSBlock(
  context: Context,
  {
    tagName,
    apiItem,
    getTitle,
  }: {
    tagName: TsDocTagNames;
    apiItem: ApiItem;
    getTitle?: (block: DocBlock, idx: number, allBlocks: DocBlock[]) => Node;
  },
) {
  return apiItem instanceof ApiDocumentedItem && apiItem.tsdocComment
    ? apiItem.tsdocComment.customBlocks
        .filter((b) => b.blockTag.tagNameWithUpperCase === StandardTags[tagName].tagNameWithUpperCase)
        .flatMap((block, idx, allBlocks) => {
          const headingTitle = getTitle ? getTitle(block, idx, allBlocks) : null;
          const data = [printTsDoc({ apiItem, apiModel: context.apiModel }, block.content)].flat();
          const markdown = root([
            ...(headingTitle ? [headingTitle] : []),
            ...trimWhitespaceInlineCode(collapseParagraphs(data)),
          ]);

          return markdown;
        })
    : [];
}

export function getTSBlockInHtml(
  context: Context,
  {
    tagName,
    apiItem,
    getTitle,
  }: {
    tagName: TsDocTagNames;
    apiItem: ApiItem;
    getTitle?: (block: DocBlock, idx: number, allBlocks: DocBlock[]) => Node;
  },
) {
  const data = getTSBlock(context, { tagName, apiItem, getTitle });

  return data.map((markdown) => toHtmlString(markdown));
}
