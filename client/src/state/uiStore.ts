/** UI state - minimal store for auth demo */

export interface UIState {
  buildMenuOpen: boolean;
  inventoryPanelOpen: boolean;
}

export const uiState: UIState = {
  buildMenuOpen: false,
  inventoryPanelOpen: false,
};

export function setBuildMenuOpen(open: boolean): void {
  uiState.buildMenuOpen = open;
}

export function setInventoryPanelOpen(open: boolean): void {
  uiState.inventoryPanelOpen = open;
}
