import { render, screen } from '@testing-library/react';
import { Button } from './Button';
import { cn } from './cn';

describe('Button', () => {
  it('renders as a non-submitting button by default', () => {
    render(<Button>Open</Button>);
    const button = screen.getByRole('button', { name: 'Open' });
    expect(button).toHaveAttribute('type', 'button');
  });

  it('applies the primary variant classes', () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-accent');
  });
});

describe('cn', () => {
  it('drops falsy values and joins the rest', () => {
    expect(cn('a', false, undefined, 'b')).toBe('a b');
  });
});
