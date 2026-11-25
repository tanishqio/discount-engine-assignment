/**
 * CSV adapter tests: the sample files, the brief's RULE-04 row and bad rows.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseRulesCSV, parseCartCSV } from '../src/engine/csvParser.js'

const sample = (name) => readFileSync(new URL(`../sample-data/${name}`, import.meta.url), 'utf8')
const HEADER = 'rule_id,scope,applies_to,type,value,stackable,min_cart_value\n'

describe('rules CSV', () => {
  it('loads the 4 sample rules, including the cart rule RULE-04', () => {
    const { data, errors } = parseRulesCSV(sample('rules.csv'))
    expect(errors).toEqual([])
    expect(data.map((r) => r.ruleId)).toEqual(['RULE-01', 'RULE-02', 'RULE-03', 'RULE-04'])
    expect(data[3]).toEqual({ ruleId: 'RULE-04', scope: 'cart', appliesTo: '', type: 'percentage', value: 10, stackable: false, minCartValue: 4000 })
  })

  it("reads the brief's rules.csv text exactly as printed", () => {
    const text = HEADER + [
      'RULE-01,platform,Amazon India,percentage,15,false,',
      'RULE-02,brand,Natura Casa,flat,150,false,',
      'RULE-03,platform,Flipkart,percentage,10,true,',
      'RULE-04,cart,,percentage,10,false,4000',
    ].join('\n')
    expect(parseRulesCSV(text)).toMatchObject({ errors: [], data: { length: 4 } })
  })

  it('still reads the original 6-column file from the base repo', () => {
    const text = 'rule_id,scope,applies_to,type,value,stackable\nRULE-01,platform,Amazon India,percentage,15,false'
    expect(parseRulesCSV(text).data).toHaveLength(1)
  })

  it('reads Excel-style files (BOM, Windows line endings, capitals, "4,000")', () => {
    const text = '\uFEFFRule_ID,Scope,Applies_To,Type,Value,Stackable,Min Cart Value\r\nRULE-04,CART,,Percentage,10,FALSE,"4,000"\r\n'
    expect(parseRulesCSV(text).data[0].minCartValue).toBe(4000)
  })

  it('skips bad rows, keeps good ones and names the row number', () => {
    const text = HEADER + 'RULE-01,platform,Amazon India,percentage,15,false,\nBAD,shop,X,flat,10,false,\nRULE-04,cart,,percentage,10,false,4000'
    const { data, errors } = parseRulesCSV(text)
    expect(data.map((r) => r.ruleId)).toEqual(['RULE-01', 'RULE-04'])
    expect(errors).toEqual(['Row 3: scope must be brand, platform or cart, got "shop"'])
  })
})

describe('cart CSV', () => {
  it('loads the 6 sample items', () => {
    const { data, errors } = parseCartCSV(sample('cart.csv'))
    expect(errors).toEqual([])
    expect(data.map((i) => i.basePrice)).toEqual([1299, 849, 599, 2499, 449, 899])
  })

  it('reports a row with a bad price and keeps the rest', () => {
    const text = 'item_id,product,brand,platform,base_price\nI1,Vase,B,P,abc\nI2,Shelf,B,P,599'
    const { data, errors } = parseCartCSV(text)
    expect(data.map((i) => i.itemId)).toEqual(['I2'])
    expect(errors[0]).toMatch(/^Row 2: base_price must be a positive number/)
  })
})
