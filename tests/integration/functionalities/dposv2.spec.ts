import * as chai from 'chai';
import { expect } from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import { Sequelize } from 'sequelize-typescript';
import * as filterObject from 'filter-object';
import initializer from '../common/init';
import {
  addNewDelegate,
  confirmTransactions,
  createRandomAccountsWithFunds,
  createRandomAccountWithFunds, createRegDelegateTransaction,
  createSendTransaction,
  createVoteTransaction, createWallet,
  findDelegateByPkey,
  findDelegateByUsername, getRandomDelegateWallet, removeDelegatePass
} from '../common/utils';
import { Symbols } from '../../../src/ioc/symbols';
import { IPeerLogic, IRoundsLogic, ITransactionLogic, ITransactionPoolLogic } from '../../../src/ioc/interfaces/logic';
import {
  IAccountsModule,
  IBlocksModule,
  IDelegatesModule,
  IRoundsModule,
  ISystemModule,
  ITransactionsModule,
  ITransportModule
} from '../../../src/ioc/interfaces/modules';
import { Ed } from '../../../src/helpers';
import { dposOffline, LiskWallet } from 'dpos-offline';
import { BlocksModel } from '../../../src/models';
import { Op } from 'sequelize';
import constants from '../../../src/helpers/constants';
import * as uuid from 'uuid';
import { toBufferedTransaction } from '../../utils/txCrafter';

chai.use(chaiAsPromised);
describe('dposv2', () => {
  const dposv2FirstBlock = constants.dposv2.firstBlock;
  before(() => {
    // Start with dposv2 algorithm afer the first round.
    constants.dposv2.firstBlock = constants.activeDelegates + 1;
  });
  after(() => {
    constants.dposv2.firstBlock = dposv2FirstBlock;
  });
  initializer.setup();

  const funds = Math.pow(10, 11);

  let cnsts: typeof constants;
  let blocksModule: IBlocksModule;
  let blocksModel: typeof BlocksModel;
  let delegatesModule: IDelegatesModule;
  let accModule: IAccountsModule;
  let txModule: ITransactionsModule;
  let txPool: ITransactionPoolLogic;
  let transportModule: ITransportModule;
  let txLogic: ITransactionLogic;
  let roundsLogic: IRoundsLogic;
  let systemModule: ISystemModule;
  let sequelize: Sequelize;
  let rounds: IRoundsModule;
  let newDelegateWallet: LiskWallet;
  let ed: Ed;

  beforeEach(async () => {
    cnsts           = initializer.appManager.container.get(Symbols.helpers.constants);
    ed              = initializer.appManager.container.get(Symbols.helpers.ed);
    blocksModule    = initializer.appManager.container.get(Symbols.modules.blocks);
    delegatesModule = initializer.appManager.container.get(Symbols.modules.delegates);
    accModule       = initializer.appManager.container.get(Symbols.modules.accounts);
    txModule        = initializer.appManager.container.get(Symbols.modules.transactions);
    transportModule = initializer.appManager.container.get(Symbols.modules.transport);
    txPool          = initializer.appManager.container.get(Symbols.logic.transactionPool);
    txLogic         = initializer.appManager.container.get(Symbols.logic.transaction);
    systemModule    = initializer.appManager.container.get(Symbols.modules.system);
    sequelize       = initializer.appManager.container.get(Symbols.generic.sequelize);
    rounds          = initializer.appManager.container.get(Symbols.modules.rounds);
    roundsLogic     = initializer.appManager.container.get(Symbols.logic.rounds);
    blocksModel     = initializer.appManager.container.get(Symbols.models.blocks);
    cnsts.dposv2.firstBlock = 102;

    const secret             = 'secret';
    newDelegateWallet        = createWallet(secret);
    await createRandomAccountWithFunds(26*1e8, newDelegateWallet);
    addNewDelegate({
      address : newDelegateWallet.address,
      keypair : {
        privateKey: newDelegateWallet.privKey,
        publicKey : newDelegateWallet.publicKey,
      },
      secret,
      username: 'outsider',
    });

    const tx  = await createRegDelegateTransaction(0, newDelegateWallet, 'outsider');
    await initializer.rawMineBlockWithTxs([tx].map(toBufferedTransaction));
    // await createVoteTransaction(1, newDelegateWallet, newDelegateWallet.publicKey, true);

  });

  afterEach(async () => {
    removeDelegatePass(newDelegateWallet.address);
  });

  initializer.createBlocks(100, 'each');
  afterEach(async function () {
    this.timeout(200000);
    await initializer.rawDeleteBlocks(blocksModule.lastBlock.height - 1);
  });

  describe('rounds', () => {
    function mapDelegate(i: any) {
      return {
        user : i.delegate.username,
        vote : i.delegate.vote,
        voteW : i.delegate.votesWeight,
        bala : i.delegate.balance,
        ubala: i.delegate.u_balance,
        pk   : i.delegate.publicKey.toString('hex'),
        addr : i.delegate.address,
        rank : i.info.rank,
        mb   : i.delegate.missedblocks,
        pb   : i.delegate.producedblocks,
      };
    }

    function mappedDelegatesToHASH<T extends { user: string }>(mappedDelegates: T[]): { [user: string]: T } {
      const toRet = {};
      mappedDelegates.forEach((item) => toRet[item.user] = item);
      return toRet;
    }

    let accounts: LiskWallet[];
    beforeEach(async function() {
      // Reorder delegates by name. genesis1 will have 1 satoshi more of voting power compared to genesis2 ...
      this.timeout(100000);
      const toRet = await createRandomAccountsWithFunds(101, funds);
      accounts    = toRet.map((item) => item.account);
      const txs   = [];
      for (let i = 1; i <= 101; i++) {
        const delegate  = findDelegateByUsername(`genesisDelegate${i}`);
        const delWallet = new dposOffline.wallets.LiskLikeWallet(delegate.secret, 'R');
        txs.push(await createVoteTransaction(
          0,
          delWallet,
          delWallet.publicKey,
          false
        ));
        txs.push(await createVoteTransaction(
          0,
          accounts[i - 1],
          delWallet.publicKey,
          true
        ));
        // reorder so that genesisDelegate1 is higher in rank than genesiDelegate2 by one satoshi
        txs.push(await createSendTransaction(0, i, accounts[i - 1], '1R'));
      }
      await confirmTransactions(txs, false);
    });

    async function getmappedDelObj() {
      const preRes       = await delegatesModule.getDelegates({ orderBy: 'vote:desc', limit: 102, includeBanned: true });
      const preResMapped = preRes.delegates.map(mapDelegate);
      return mappedDelegatesToHASH(preResMapped);
    }

    async function getPREPostOBJ() {
      const curRound = roundsLogic.calcRound(blocksModule.lastBlock.height);
      const preOBJ   = await getmappedDelObj();
      const toMine   = roundsLogic.lastInRound(curRound) - blocksModule.lastBlock.height;
      for (let i = 0; i < toMine - 1; i++) {
        await initializer.rawMineBlocks(1);
        expect(filterObject(preOBJ, ['!*.mb', '!*.pb']))
          .to.be.deep.eq(filterObject(await getmappedDelObj(), ['!*.mb', '!*.pb']));
      }

      const preLastBlock = await getmappedDelObj();
      await initializer.rawMineBlocks(1);

      const postOBJ = await getmappedDelObj();

      // should contain same delegates (even if sorted in another order)
      expect(Object.keys(preOBJ).sort()).to.be.deep.eq(Object.keys(postOBJ).sort());
      expect(preOBJ).to.not.be.deep.eq(postOBJ);
      expect(filterObject(preLastBlock, ['*.vote'])).to.not.be.deep.eq(filterObject(postOBJ, ['*.vote']));
      expect(filterObject(preLastBlock, ['*.bala'])).to.not.be.deep.eq(filterObject(postOBJ, ['*.bala']));
      expect(blocksModule.lastBlock.height % cnsts.activeDelegates).eq(0);
      return { preOBJ, preLastBlock, postOBJ };
    }

    describe('endRoundApply', () => {

      it('should update delegates amounts', async function () {
        this.timeout(10000);
        const { preOBJ, preLastBlock, postOBJ } = await getPREPostOBJ();

        const blocks       = await blocksModel.findAll({
          where: { height: { [Op.gt]: 101 } },
        });
        const totalRewards = blocks
          .map((x) => x.totalFee)
          .reduce((a, b) => a + b, 0);
        for (const block of blocks) {
          const res      = findDelegateByPkey(block.generatorPublicKey.toString('hex'));
          const username = res.username;
          expect(preLastBlock[username].bala).to.be.eq(preOBJ[username].bala);
          expect(postOBJ[username].bala).to.be.eq(
            preOBJ[username].bala + block.reward + totalRewards / 101
          );
        }
      });
      it('should update delegate votes and rank!', async function () {
        this.timeout(10000);

        const { postOBJ } = await getPREPostOBJ();
        for (let i = 1; i <= 101; i++) {
          const delegateName = `genesisDelegate${i}`;

          expect(postOBJ[delegateName].vote).to.be.eq(99890000000 - i);
          expect(delegateName).to.be.eq(`genesisDelegate${i}`);
          expect(postOBJ[delegateName].rank).to.be.eq(i);
        }
      });

    });

    describe('remainderFees', function () {
      this.timeout(20000);

      beforeEach(async () => {
        const curRound = roundsLogic.calcRound(blocksModule.lastBlock.height);
        const lastHeight = roundsLogic.lastInRound(curRound);
        await initializer.rawMineBlocks(lastHeight - blocksModule.lastBlock.height);
      });

      it('should account them properly', async () => {
        await createRandomAccountWithFunds();
        const curRound = roundsLogic.calcRound(blocksModule.lastBlock.height);
        const lastHeight = roundsLogic.lastInRound(curRound);

        const delegatesObj = await getmappedDelObj();
        // on pre everything is still the same.
        await initializer.rawMineBlocks(lastHeight - blocksModule.lastBlock.height - 1);
        expect(filterObject(await getmappedDelObj(), ['!*.pb'])).deep.eq(filterObject(delegatesObj, ['!*.pb']));

        await initializer.rawMineBlocks(1);

        const lastGeneratorPublic = blocksModule.lastBlock.generatorPublicKey.toString('hex');
        const afterApply          = await getmappedDelObj();
        const feeDecimal          = Math.floor(1e7 / 101);
        const feeReminder         = 1e7 - Math.floor(1e7 / 101) * 101;
        let delegateReplaced = null;
        for (let i = 1; i <= 101; i++) {
          const delegate  = `genesisDelegate${i}`;
          let totalAmount = delegatesObj[delegate].bala + 15 * 1e8 + feeDecimal;
          if (afterApply[delegate].pk === lastGeneratorPublic) {
            totalAmount += feeReminder;
          }
          if (afterApply[delegate].bala !== totalAmount ) {
            if (delegateReplaced) {
              throw new Error('A delegate was replaced already by outsider');
            }
            delegateReplaced = delegate;
          }
        }

        if (delegateReplaced) {
          expect(afterApply['outsider'].bala).eq(delegatesObj.outsider.bala + 15 * 1e8 + feeDecimal);
        }
        // It should re-store object as it was before mining last block in round
        await initializer.rawDeleteBlocks(1);
        expect(filterObject(await getmappedDelObj(), ['!*.pb'])).deep.eq(filterObject(delegatesObj, ['!*.pb']));
      });
    });

    describe('endRound + rollback', () => {
      it('rollback should return to original preOBJ', async function () {
        this.timeout(20000);
        const { preLastBlock} = await getPREPostOBJ();

        await initializer.rawDeleteBlocks(1);

        const nowOBJ      = await getmappedDelObj();
        expect(nowOBJ).to.be.deep.eq(preLastBlock);
      });
      it('end + rollback + end should give same result as end only', async function () {
        this.timeout(20000);
        const { postOBJ } = await getPREPostOBJ();

        await initializer.rawDeleteBlocks(1);
        await initializer.rawMineBlocks(1);
        const nowOBJ      = await getmappedDelObj();

        expect(nowOBJ).to.be.deep.eq(postOBJ);
      });
      it('end + 2 delete + end should give same result as end only', async function ()  {
        this.timeout(20000);
        const { postOBJ } = await getPREPostOBJ();
        await initializer.rawDeleteBlocks(2);
        await initializer.rawMineBlocks(2);
        const nowOBJ      = await getmappedDelObj();

        expect(nowOBJ).deep.eq(postOBJ);
      });

      it('should return to initial state after full round and then rollback', async function () {
        this.timeout(100000);
        const initHeight = blocksModule.lastBlock.height;
        const pre = await getmappedDelObj();
        // mines exatly to the end of the current round
        await getPREPostOBJ();

        await initializer.rawDeleteBlocks(blocksModule.lastBlock.height - initHeight);

        expect(blocksModule.lastBlock.height).eq(initHeight);

        const post = await getmappedDelObj();

        expect(pre).deep.eq(post);

      });
    });
  });

});
