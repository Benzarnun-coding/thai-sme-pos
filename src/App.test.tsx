import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from './App'

describe('Pixel POS App', () => {
  it('renders the initial POS view with categories and menu items', () => {
    render(<App />)
    
    // Check sidebar
    // Search for the container that has the TERMINAL button
    const terminalBtn = screen.getByText('TERMINAL');
    const navSidebar = terminalBtn.closest('aside');
    expect(navSidebar).toBeInTheDocument();
    
    // Check main header
    expect(screen.getByText('PIXEL POS v3.0')).toBeInTheDocument()

    // Check categories
    expect(screen.getByRole('button', { name: 'COFFEE' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'BAKERY' })).toBeInTheDocument()

    // Check a menu item exists
    expect(screen.getByText('ICED AMERICANO')).toBeInTheDocument()
  })

  it('adds an item without modifiers to the cart', async () => {
    const user = userEvent.setup()
    render(<App />)
    
    // Find an item without modifiers (e.g. DIRTY COFFEE)
    const dirtyCoffee = screen.getByText('DIRTY COFFEE')
    await user.click(dirtyCoffee)

    // Check if cart updates. The cart is in an aside. 
    // We can identify the cart container by the text "ORDER LIST"
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Check item in cart
    expect(within(cartContainer).getByText('DIRTY COFFEE')).toBeInTheDocument()
    
    // Check total price update in cart (Dirty Coffee is 95)
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('95.-')).toBeInTheDocument()
  })

  it('handles item with modifiers correctly', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Click on ICED AMERICANO which has modifiers
    await user.click(screen.getByText('ICED AMERICANO'))

    // Check if modifier modal appears
    expect(screen.getByText('SWEETNESS')).toBeInTheDocument()

    // Select 50% sweetness
    const sweet50 = screen.getByText('50%')
    await user.click(sweet50)

    // Add to order
    await user.click(screen.getByText('ADD TO ORDER'))

    // Check if modal closed
    await waitFor(() => {
      expect(screen.queryByText('ADD TO ORDER')).not.toBeInTheDocument()
    })

    // Scope to Cart
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!

    // Check item in cart
    expect(within(cartContainer).getByText('ICED AMERICANO')).toBeInTheDocument()
    
    // Check TOTAL. Iced Americano is 45. Modifier 50% is 0 price.
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('45.-')).toBeInTheDocument()
  })

  it('updates quantity in cart', async () => {
    render(<App />)
    
    // Add Dirty Coffee
    fireEvent.click(screen.getByText('DIRTY COFFEE'))
    
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Find quantity controls in cart. 
    const increaseBtn = within(cartContainer).getByRole('button', { name: '+' })
    fireEvent.click(increaseBtn)
    
    // Quantity should be 2
    await waitFor(() => {
      expect(within(cartContainer).getByText('2')).toBeInTheDocument()
    })
    
    // Total price should be 95 * 2 = 190
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('190.-')).toBeInTheDocument()
  })

  it('removes item from cart', async () => {
    render(<App />)
    
    // Add Dirty Coffee
    fireEvent.click(screen.getByText('DIRTY COFFEE'))
    
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Verify it's there
    expect(within(cartContainer).getByText('DIRTY COFFEE')).toBeInTheDocument()
    
    // Click remove button (X) inside the cart
    const removeBtn = within(cartContainer).getByRole('button', { name: 'X' })
    fireEvent.click(removeBtn)

    // Verify cart is empty
    await waitFor(() => {
      expect(within(cartContainer).getByText('CART IS EMPTY')).toBeInTheDocument()
    })
  })

  it('completes the checkout flow', async () => {
    const user = userEvent.setup()
    render(<App />)
    
    // Add item
    await user.click(screen.getByText('DIRTY COFFEE'))
    
    // Click Checkout
    await user.click(screen.getByText('CHECKOUT'))
    
    // Payment modal should appear
    expect(screen.getByText('PAYMENT')).toBeInTheDocument()
    expect(screen.getByText('PAID')).toBeInTheDocument()
    
    // Click Paid
    await user.click(screen.getByText('PAID'))
    
    // Should switch to Receipt view
    expect(screen.getByText('PAYMENT SUCCESS')).toBeInTheDocument()
    
    // Click New Order
    await user.click(screen.getByText('NEW ORDER'))
    
    // Should be back to POS
    expect(screen.getByText('ORDER LIST')).toBeInTheDocument()
    expect(screen.getByText('CART IS EMPTY')).toBeInTheDocument()
  })
})
