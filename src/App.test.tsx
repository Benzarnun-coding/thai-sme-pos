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
    expect(screen.getByRole('button', { name: 'ผู้ชาย' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ขายส่ง' })).toBeInTheDocument()

    // Check a menu item exists
    expect(screen.getByText('ยีนส์ทรงกระบอกเล็ก สีดำ')).toBeInTheDocument()
  })

  it('adds an item without modifiers to the cart', async () => {
    const user = userEvent.setup()
    render(<App />)
    
    // Find an item without modifiers (the wholesale set)
    const dirtyCoffee = screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ')
    await user.click(dirtyCoffee)

    // Check if cart updates. The cart is in an aside. 
    // We can identify the cart container by the text "ORDER LIST"
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Check item in cart
    expect(within(cartContainer).getByText('ชุดขายส่ง 20 ตัว คละแบบ')).toBeInTheDocument()
    
    // Check total price update in cart (wholesale set is 4000)
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('4000.-')).toBeInTheDocument()
  })

  it('handles item with modifiers correctly', async () => {
    const user = userEvent.setup()
    render(<App />)

    // Click on ICED AMERICANO which has modifiers
    await user.click(screen.getByText('ยีนส์ทรงกระบอกเล็ก สีดำ'))

    // Check if modifier modal appears
    expect(screen.getByText('ไซส์')).toBeInTheDocument()

    // Select size 32
    const sweet50 = screen.getByText('32')
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
    expect(within(cartContainer).getByText('ยีนส์ทรงกระบอกเล็ก สีดำ')).toBeInTheDocument()
    
    // Check TOTAL. Straight-leg jeans are 199. Size modifier is 0 price.
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('199.-')).toBeInTheDocument()
  })

  it('updates quantity in cart', async () => {
    render(<App />)
    
    // Add wholesale set
    fireEvent.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))
    
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Find quantity controls in cart. 
    const increaseBtn = within(cartContainer).getByRole('button', { name: '+' })
    fireEvent.click(increaseBtn)
    
    // Quantity should be 2
    await waitFor(() => {
      expect(within(cartContainer).getByText('2')).toBeInTheDocument()
    })
    
    // Total price should be 4000 * 2 = 8000
    const totalSection = within(cartContainer).getByText('TOTAL').closest('div')!
    expect(within(totalSection).getByText('8000.-')).toBeInTheDocument()
  })

  it('removes item from cart', async () => {
    render(<App />)
    
    // Add wholesale set
    fireEvent.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))
    
    const cartContainer = screen.getByText('ORDER LIST').closest('aside')!
    
    // Verify it's there
    expect(within(cartContainer).getByText('ชุดขายส่ง 20 ตัว คละแบบ')).toBeInTheDocument()
    
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
    await user.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))
    
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
