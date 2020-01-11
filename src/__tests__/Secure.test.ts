import { SecureImpl, Params, randomStringDefault } from '../Secure'
import { PkceSource } from '../Pkce'
import { Substitute, SubstituteOf } from '@fluffy-spoon/substitute'
import * as queryString from 'query-string'
import 'jest-localstorage-mock'
import axios from 'axios'
import { Optional } from '../Lang'
jest.mock('axios')
const mockAxios = axios as jest.Mocked<typeof axios>;

beforeEach(() => {
    sessionStorage.clear();
})

describe('randomStringDefault', () => {

    it('generates correct random values', () => {
        let results = new Map<string, boolean>()
        let iterations = 1000
        for (let i = 0; i < iterations; i++) {
            let s = randomStringDefault(32)
            expect(s).toMatch(/^[A-Za-z0-9]{32}$/)
            results.set(s, true)
        }
        expect(results.size).toBe(iterations)
    })
})

describe('SecureImpl', () => {

    const storageKey = 'authlogic.storage'

    const errorCategory = "test-error"
    const errorDescription = "test-error-description"

    const issuer = 'test-issuer'
    const clientId = 'test-client-id'
    const scope = 'test-scope'

    const verifier = 'test-verifier'
    const challenge = 'test-challenge'
    const code = 'test-code'
    const state = 'test-state'
    const nonce = 'test-nonce'

    let query = ''

    let pkceSource: SubstituteOf<PkceSource>

    let unit: SecureImpl
    let error: Optional<Error>

    let params = (): Params => {
        return {
            issuer: issuer,
            clientId: clientId,
            scope: scope,
        }
    }

    let makeUnit = (): SecureImpl => {
        let _unit = new SecureImpl(params(), pkceSource)
        _unit.randomString = (length: number) => `stub-${length}`;
        _unit.getQuery = () => query;
        return _unit
    }

    let redirectTo: string

    beforeEach(async () => {
        redirectTo = ''
        query = ''
        error = undefined
        pkceSource = Substitute.for<PkceSource>()
        window.location.assign = jest.fn((value) => { redirectTo = value })
        sessionStorage.removeItem(storageKey)
    })

    describe('initial', () => {
        unit = new SecureImpl(params(), pkceSource);
        it('has no authentication', async () => {
            expect(await unit.getAuthentication()).toBeUndefined();
        })
        it('has no session storage', () => {
            expect(sessionStorage.__STORE__).toEqual({});
        })
    });

    describe('authorization_code', () => {

        beforeEach(() => {
            unit = makeUnit()
        })

        describe('Secure', () => {
            beforeEach(async () => {
                pkceSource.create().returns({
                    challenge: challenge,
                    verifier: verifier
                })
                await unit.secure()
            })
            it('has no authentication', async () => {
                expect(await unit.getAuthentication()).toBeUndefined();
            })
            it('redirected to the endpoint', () => {
                expect(redirectTo).toBe(`test-issuer/authorize?client_id=test-client-id&redirect_uri=${encodeURIComponent(window.location.href)}&state=stub-32&nonce=stub-32&response_type=code`)
            })
            it('stores state and nonce', () => {
                expect(JSON.parse(sessionStorage.__STORE__[storageKey])).toEqual({
                    pkce: {
                        challenge: challenge,
                        verifier: verifier
                    },
                    state: 'stub-32',
                    nonce: 'stub-32'
                });
            })
        });

        describe('return with code without storage', () => {
            it('throws an error', async () => {
                query = `?code=${code}`
                try {
                    await unit.secure()
                    fail('Expected an error')
                } catch (e) {
                    expect(e).toEqual(new Error('Nothing in storage'));
                }
            })
        });

        describe('return with oauth error message', () => {

            beforeEach(async () => {
                query = `?error=${errorCategory}&error_description=${errorDescription}`
                try {
                    await unit.secure()
                } catch (e) {
                    error = e
                }
            })
            it('throws an error', () => {
                expect(error).toEqual(new Error(`[${errorCategory}] ${errorDescription}`))
            })
        })

        describe('return with code and storage', () => {

            beforeEach(async () => {
                query = `?code=${code}`
                sessionStorage.__STORE__[storageKey] = JSON.stringify({
                    pkce: {
                        challenge: challenge,
                        verifier: verifier
                    },
                    state: state,
                    nonce: nonce
                })
            })

            describe('server error', () => {
                beforeEach(async () => {
                    const err = new Error('Host cannot be reached')
                    try {
                        mockAxios.post.mockRejectedValue(err)
                        await unit.secure()
                        fail('Expected exception')
                    } catch (e) {
                        expect(e).toEqual(err)
                    }
                })
                it('makes call to token endpoint', async () => {
                    expect(mockAxios.post).toHaveBeenCalledWith(issuer + '/oauth/token',
                        queryString.stringify({
                            grant_type: 'authorization_code',
                            code: code,
                            code_verifier: verifier
                        }),
                        {
                            adapter: require('axios/lib/adapters/xhr'),
                            headers: { 'Content-Type': 'multipart/form-data' }
                        })
                });
            })

            describe('oauth error', () => {
                beforeEach(async () => {
                    mockAxios.post.mockResolvedValue({
                        data: JSON.stringify({
                            error: errorCategory,
                            error_description: errorDescription,
                        })
                    });
                    try {
                        await unit.secure()
                    } catch (e) {
                        error = e
                    }
                })
                it('throws an error', () => {
                    expect(error).toEqual(new Error(`[${errorCategory}] ${errorDescription}`))
                });
                it('sets authentication to undefined', async () => {
                    expect(await unit.getAuthentication()).toBeUndefined()
                })
                it('makes call to token endpoint', async () => {
                    expect(mockAxios.post).toHaveBeenCalledWith(issuer + '/oauth/token',
                        queryString.stringify({
                            grant_type: 'authorization_code',
                            code: code,
                            code_verifier: verifier
                        }),
                        {
                            adapter: require('axios/lib/adapters/xhr'),
                            headers: { 'Content-Type': 'multipart/form-data' }
                        })
                });
            })
        })
    })
})