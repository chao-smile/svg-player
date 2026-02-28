declare module "page-flip" {
  export type FlipCorner = "top" | "bottom";

  export type PageFlipSettings = {
    width: number;
    height: number;
    size?: "fixed" | "stretch";
    minWidth?: number;
    maxWidth?: number;
    minHeight?: number;
    maxHeight?: number;
    drawShadow?: boolean;
    flippingTime?: number;
    usePortrait?: boolean;
    startZIndex?: number;
    startPage?: number;
    autoSize?: boolean;
    maxShadowOpacity?: number;
    showCover?: boolean;
    mobileScrollSupport?: boolean;
    swipeDistance?: number;
    clickEventForward?: boolean;
    useMouseEvents?: boolean;
    disableFlipByClick?: boolean;
  };

  export class PageFlip {
    constructor(root: HTMLElement, settings: PageFlipSettings);
    loadFromHTML(items: NodeListOf<Element> | HTMLElement[]): void;
    turnToPage(pageNum: number): void;
    getCurrentPageIndex(): number;
    flip(pageNum: number, corner?: FlipCorner): void;
    destroy(): void;
  }
}
