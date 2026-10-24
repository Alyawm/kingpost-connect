import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@kingpost/ui';
import { App } from './App';
import { useUi } from './state/ui';

// The viewport needs WebGL; jsdom has none. The shell is what these tests exercise.
vi.mock('@kingpost/viewer', () => ({
  Viewport: () => <canvas data-testid="viewport" />,
  createSampleFrame: () => ({}),
  loadIfcToGroup: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

function renderApp() {
  return render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  useUi.setState({
    section: 'explorer',
    leftOpen: true,
    rightOpen: true,
    bottomOpen: true,
    paletteOpen: false,
  });
});

describe('App shell', () => {
  it('renders the rail, side panel, inspector and output', () => {
    renderApp();
    expect(screen.getByRole('navigation', { name: 'Sections' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Side panel' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Output' })).toBeInTheDocument();
    expect(screen.getByTestId('viewport')).toBeInTheDocument();
  });

  it('folds the side panel with Ctrl+B', async () => {
    renderApp();
    await userEvent.keyboard('{Control>}b{/Control}');
    expect(screen.queryByRole('complementary', { name: 'Side panel' })).not.toBeInTheDocument();
  });

  it('opens the command palette with Ctrl+K and lists commands', async () => {
    renderApp();
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByPlaceholderText('Type a command…')).toBeInTheDocument();
    expect(screen.getByText('Toggle inspector')).toBeInTheDocument();
  });

  it('reports the web preview in the status bar when not running in Tauri', async () => {
    renderApp();
    expect(await screen.findByText('KingPost Connect web preview')).toBeInTheDocument();
  });

  it('switches section from the rail', async () => {
    renderApp();
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    });
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
  });
});
