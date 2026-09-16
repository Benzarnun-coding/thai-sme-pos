import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect } from 'vitest'
import App from './App'

/** The cart lives in its own <aside>; find it by its heading. */
const cart = () => screen.getByText('ตะกร้า').closest('aside')!
/** The cart's total row — prices also appear on the product cards, so scope to it. */
const cartTotal = () => within(cart()).getByText('ยอดรวม').closest('div')!

describe('POS', () => {
  it('renders the POS view with the nav, categories and products', () => {
    render(<App />)

    expect(screen.getByRole('button', { name: 'ขายหน้าร้าน' }).closest('aside')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ผู้ชาย' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ขายส่ง' })).toBeInTheDocument()
    expect(screen.getByText('ยีนส์ทรงกระบอกเล็ก สีดำ')).toBeInTheDocument()
  })

  it('adds an item without modifiers straight to the cart', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))

    expect(within(cart()).getByText('ชุดขายส่ง 20 ตัว คละแบบ')).toBeInTheDocument()
    expect(within(cartTotal()).getByText('฿4,000')).toBeInTheDocument()
  })

  it('asks for modifiers first when the item has them', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('ยีนส์ทรงกระบอกเล็ก สีดำ'))
    expect(screen.getByText('ไซส์')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '32' }))
    await user.click(screen.getByText('ใส่ตะกร้า'))

    await waitFor(() => expect(screen.queryByText('ใส่ตะกร้า')).not.toBeInTheDocument())

    expect(within(cart()).getByText('ยีนส์ทรงกระบอกเล็ก สีดำ')).toBeInTheDocument()
    expect(within(cartTotal()).getByText('฿199')).toBeInTheDocument()
  })

  it('changes the quantity from the cart', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))
    await user.click(within(cart()).getByRole('button', { name: 'เพิ่มจำนวน' }))

    expect(within(cart()).getByText('2')).toBeInTheDocument()
    expect(within(cartTotal()).getByText('฿8,000')).toBeInTheDocument()
  })

  it('removes an item from the cart', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByText('ชุดขายส่ง 20 ตัว คละแบบ'))
    expect(within(cart()).getByText('ชุดขายส่ง 20 ตัว คละแบบ')).toBeInTheDocument()

    await user.click(within(cart()).getByRole('button', { name: 'ลบ' }))

    expect(within(cart()).getByText('ยังไม่มีสินค้าในตะกร้า')).toBeInTheDocument()
  })
})
